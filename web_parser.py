import argparse
import json
import os
import re
import sys
import unicodedata
import requests
from bs4 import BeautifulSoup, NavigableString

# --- EINSTELLUNGEN ---
GENERATE_JSON = True
GENERATE_JS = True
# ---------------------

VERB_GROUP_OVERRIDES = {
    "etre": "troisième groupe",
}


def clean_french_conjugation(text, pronoun=None):
    """Sorgt für eine saubere Trennung zwischen Pronomen und Verb."""
    text = re.sub(r"[\*\s\xa0]+$", "", text).strip()
    text = re.sub(r"\s+", " ", text)

    if pronoun is None:
        parts = text.split(" ", 1)
        if len(parts) == 2:
            pronoun, verb_part = parts
        else:
            return text
    else:
        verb_part = text[len(pronoun) :].strip()

    if pronoun in ["j'", "qu'"]:
        return f"{pronoun}{verb_part}"

    verb_part = re.sub(
        r"^([stmdnl])\s+([aeiouyàâäéèêëîïôöùûüœ])",
        r"\1\2",
        verb_part,
        flags=re.I,
    )
    return f"{pronoun} {verb_part}"


def normalize_french_group(group_text: str) -> str:
    normalized = group_text.lower()
    normalized = normalized.replace("é", "e").replace("è", "e").replace("ê", "e").replace("ë", "e")
    normalized = normalized.replace("î", "i").replace("ï", "i")
    normalized = normalized.replace("à", "a").replace("â", "a").replace("ä", "a")
    normalized = normalized.replace("ù", "u").replace("û", "u").replace("ü", "u")

    if "trois" in normalized or re.search(r"\b3(?:e|eme|eme|eme)\b", normalized):
        return "troisième groupe"
    if "deux" in normalized or re.search(r"\b2(?:e|eme|eme|eme)\b", normalized):
        return "deuxième groupe"
    if "prem" in normalized or re.search(r"\b1(?:er)?\b", normalized):
        return "premier groupe"
    return group_text.strip().lower()


def parse_conjugation(url):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    try:
        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            print(f"Fehler beim Laden der Seite: Status {response.status_code}, URL: {url}")
            return None
    except Exception as e:
        print(f"Netzwerkfehler: {e}, URL: {url}")
        return None

    soup = BeautifulSoup(response.text, "html.parser")
    url_verb = url.rstrip("/\n").split("/")[-1].replace(".html", "")
    verb_data = {
        "verbe": url_verb,
        "infinitif": url_verb,
        "groupe": None,
        "auxiliaire": None,
        "modes": {},
    }

    page_title = soup.find("h1")
    if page_title:
        title_text = page_title.get_text(" ", strip=True)
        title_match = re.search(r"Conjugaison du verbe\s+(.+)", title_text, re.I)
        if title_match:
            page_verb = title_match.group(1).strip()
            verb_data["verbe"] = page_verb
            verb_data["infinitif"] = page_verb

    info_text = " ".join(
        p.get_text(" ", strip=True)
        for p in soup.find_all("p")
        if p.get_text(strip=True)
    )
    if info_text:
        groupe_match = re.search(r"(trois[iîeéè]+me groupe|1er groupe|premier groupe|deuxième groupe|deuxieme groupe)", info_text, re.I)
        if groupe_match:
            verb_data["groupe"] = normalize_french_group(groupe_match.group(1))
        elif url_verb in VERB_GROUP_OVERRIDES:
            verb_data["groupe"] = VERB_GROUP_OVERRIDES[url_verb]

        aux_paragraph = next(
            (
                p
                for p in soup.find_all("p")
                if p.get_text(" ", strip=True).lower().startswith("auxiliaire")
            ),
            None,
        )
        if aux_paragraph:
            aux_text = aux_paragraph.get_text(" ", strip=True)
            aux_matches = re.findall(r"(?:l'|l’)?auxiliaire\s+([A-Za-zéèêëîïôöùûüœ]+)", aux_text, re.I)
            for match in aux_matches:
                normalized_aux = match.lower()
                if normalized_aux in {"être", "etre", "avoir"}:
                    verb_data["auxiliaire"] = "avoir" if normalized_aux == "etre" else normalized_aux
                    break
        else:
            aux_match = re.search(r"(?:l'|l’)?auxiliaire\s+([A-Za-zéèêëîïôöùûüœ]+)", info_text, re.I)
            if aux_match:
                normalized_aux = aux_match.group(1).lower()
                if normalized_aux in {"être", "etre", "avoir"}:
                    verb_data["auxiliaire"] = "avoir" if normalized_aux == "etre" else normalized_aux

    blocks = soup.find_all("div", class_="conjugBloc")

    def normalize_conjugation_text(text):
        text = re.sub(r"\s+", " ", text).strip()
        text = re.sub(r"\bj'\s+", "j'", text, flags=re.I)
        text = re.sub(r"\bqu'\s+", "qu'", text, flags=re.I)
        text = re.sub(
            r"\b([bcdfghjklmnpqrstvwxyzç])\s+([aeiouyàâäéèêëîïôöùûüœ])",
            r"\1\2",
            text,
            flags=re.I,
        )
        text = re.sub(r"\b(a|as|avons|avez|ont)\s+su\b", r"\1 su", text, flags=re.I)
        text = re.sub(r"\b(a|as|avons|avez|ont)\s+été\b", r"\1 été", text, flags=re.I)
        return text

    for block in blocks:
        mode_element = block.find_previous("h2", class_="modeBloc")
        if not mode_element:
            continue

        mode_name = mode_element.get_text(strip=True)
        title_element = block.find("div", class_="tempsBloc")
        if not title_element:
            continue

        temps_title = title_element.get_text(strip=True)

        conjugations = []
        current_parts = []
        seen_title = False
        for child in block.children:
            if child == title_element:
                seen_title = True
                continue
            if not seen_title:
                continue

            if getattr(child, "name", None) == "br":
                if current_parts:
                    line = " ".join(current_parts).strip()
                    line = normalize_conjugation_text(line)
                    if line:
                        conjugations.append(clean_french_conjugation(line))
                    current_parts = []
                continue

            if isinstance(child, NavigableString):
                text = child.strip()
                if text:
                    current_parts.append(text)
                continue

            text = child.get_text(" ", strip=True)
            if text:
                current_parts.append(text)

        if current_parts:
            line = " ".join(current_parts).strip()
            line = normalize_conjugation_text(line)
            if line:
                conjugations.append(clean_french_conjugation(line))

        if conjugations:
            verb_data["modes"].setdefault(mode_name, {})[temps_title] = conjugations

    return verb_data


def load_verbs_from_file(path):
    with open(path, encoding="utf-8") as f:
        return [line.strip() for line in f if line.strip() and not line.lstrip().startswith("#")]


def save_verbs_file(path, verbs):
    with open(path, "w", encoding="utf-8") as f:
        for verb in verbs:
            f.write(f"{verb}\n")


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)


def save_js(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json_text = json.dumps(data, ensure_ascii=False, indent=4)
        f.write(f"window.verbDaten = {json_text};")


def normalize_filename(name: str) -> str:
    normalized = unicodedata.normalize("NFKD", name)
    normalized = normalized.encode("ascii", "ignore").decode("ascii")
    normalized = normalized.replace(" ", "_").replace("/", "_")
    normalized = re.sub(r"[^A-Za-z0-9_\-\.]+", "", normalized)
    return normalized.lower() if normalized else name


def normalize_verb_entry(verb: str) -> str:
    return verb.strip().casefold()


def canonical_verb(verb: str) -> str:
    normalized = unicodedata.normalize("NFKD", verb)
    normalized = normalized.encode("ascii", "ignore").decode("ascii")
    return normalized.casefold().strip()


def unique_verbs(verbs):
    seen = {}
    for verb in verbs:
        key = canonical_verb(verb)
        if key and key not in seen:
            seen[key] = normalize_verb_entry(verb)
    return list(seen.values())


def sort_verbs(verbs):
    return sorted(
        verbs,
        key=lambda verb: (canonical_verb(verb), verb),
    )


def main():
    parser = argparse.ArgumentParser(
        description="Französische Verbkonjugationen parsen und JSON erzeugen.",
        epilog=(
            "Beispiele:\n"
            "  python web_parser_full.py --verbs savoir etre aller\n"
            "  python web_parser_full.py --file verbs.txt --output-dir output --force\n"
            "  python web_parser_full.py --verbs aller --only-json\n"
            "  python web_parser_full.py --file verbs.txt --no-js\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--verbs", nargs="*", help="Liste von Verben, z. B. --verbs savoir etre aller")
    parser.add_argument("--file", default="verbs.txt", help="Datei mit einem Verb pro Zeile (Standard: verbs.txt im Skriptverzeichnis)")
    parser.add_argument("--output-dir", default=".", help="Verzeichnis für die Ausgabedateien")
    parser.add_argument("--no-js", action="store_true", help="Erzeuge keine .js-Dateien. JSON-Dateien werden normal verarbeitet.")
    parser.add_argument("--only-json", action="store_true", help="Erzeuge nur die JSON-Dateien. JS-Dateien werden übersprungen.")
    parser.add_argument("--force", action="store_true", help="Überschreibe vorhandene JSON/JS-Dateien")
    args = parser.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    verbs = []
    script_dir = os.path.dirname(os.path.abspath(__file__))
    verbs_file = os.path.abspath(os.path.join(script_dir, args.file))
    verbs_file_exists = os.path.exists(verbs_file)

    existing_verbs = load_verbs_from_file(verbs_file) if verbs_file_exists else []
    verbs.extend(existing_verbs)
    if args.verbs:
        verbs.extend(args.verbs)
    if not verbs:
        verbs = ["savoir"]

    verbs = unique_verbs(verbs)
    verbs = sort_verbs(verbs)
    existing_keys = {canonical_verb(verb) for verb in existing_verbs}
    new_verbs = [verb for verb in verbs if canonical_verb(verb) not in existing_keys]
    save_verbs_file(verbs_file, verbs)
    if verbs_file_exists:
        print(f"Verbdatei aktualisiert: {verbs_file}")
    else:
        print(f"Verbdatei erstellt: {verbs_file}")
    if new_verbs:
        print(f"Neue Verben hinzugefügt: {', '.join(new_verbs)}")
    else:
        print("Keine neuen Verben zur Liste hinzugefügt.")

    output_dir = os.path.abspath(os.path.join(script_dir, args.output_dir))
    os.makedirs(output_dir, exist_ok=True)

    created_json = []
    created_js = []
    skipped = 0

    for verb in verbs:
        verb = verb.strip()
        if not verb:
            continue

        filename = normalize_filename(verb)
        if filename != verb:
            print(f"Normalisiere Dateiname: '{verb}' -> '{filename}'")

        json_path = os.path.join(output_dir, f"{filename}.json")
        js_path = os.path.join(output_dir, f"{filename}.js")

        if os.path.exists(json_path) and os.path.exists(js_path) and not args.force:
            print(f"Überspringe '{verb}': JSON und JS bereits vorhanden.")
            skipped += 1
            continue

        if os.path.exists(json_path) and not args.force:
            print(f"JSON für '{verb}' existiert bereits: {json_path}. Erzeuge fehlende Dateien.")
            with open(json_path, encoding="utf-8") as f:
                data = json.load(f)
            if not args.only_json and not args.no_js and not os.path.exists(js_path):
                save_js(js_path, data)
                created_js.append(js_path)
                print(f"JS-Datei für '{verb}' erfolgreich erstellt: {js_path}")
            continue

        url_verb = normalize_filename(verb)
        url = f"https://leconjugueur.lefigaro.fr/conjugaison/verbe/{url_verb}.html"
        data = parse_conjugation(url)
        if not data:
            print(f"Fehler: Konnte '{verb}' nicht parsen. URL: {url}")
            continue

        if GENERATE_JSON:
            save_json(json_path, data)
            created_json.append(json_path)
            print(f"JSON für '{verb}' erfolgreich erstellt: {json_path}")

        if not args.only_json and GENERATE_JS and not args.no_js:
            save_js(js_path, data)
            created_js.append(js_path)
            print(f"JS für '{verb}' erfolgreich erstellt: {js_path}")

    if created_json:
        print(f"Erzeugte JSON-Dateien: {len(created_json)}")
    else:
        print("Keine neuen JSON-Dateien erzeugt.")

    if args.only_json:
        print("JS-Erzeugung übersprungen: --only-json gesetzt.")
    elif args.no_js:
        print("JS-Erzeugung übersprungen: --no-js gesetzt.")
    else:
        if created_js:
            print(f"Erzeugte JS-Dateien: {len(created_js)}")
        else:
            print("Keine neuen JS-Dateien erzeugt.")

    if skipped:
        print(f"Übersprungene Verben: {skipped}")


if __name__ == "__main__":
    main()
