#!/usr/bin/env python3
"""Builds the Bibles bundled with OpenPres (tauri/resources/bibles/*.json.gz).

Only public-domain texts are bundled. Sources (downloaded into a work folder):
  RVA  Reina-Valera Antigua (1909)  scrollmapper/bible_databases     formats/json/SpaRV.json
  VDC  Cornilescu (1924)            thiagobodruk/bible               json/ro_vdc.json
                                    (checked verse by verse against eBible's public-domain
                                    Cornilescu 1924, which is only published in Cyrillic)
  KJV  King James Version (1769)    scrollmapper/bible_databases     formats/json/KJV.json

Usage: build.py <work-dir> <out-dir>   (downloads what is missing into work-dir)
Output format (one gzip JSON per translation):
  {"id", "abbreviation", "name", "language", "license", "attribution", "source",
   "books": [{"code": "GEN", "name": "Génesis", "chapters": [["v1", "v2", ...], ...]}]}
"""
import gzip, json, os, re, sys, urllib.request

USFM = ("GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM "
        "EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP "
        "COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV").split()

SPANISH = ["Génesis", "Éxodo", "Levítico", "Números", "Deuteronomio", "Josué", "Jueces", "Rut", "1 Samuel",
    "2 Samuel", "1 Reyes", "2 Reyes", "1 Crónicas", "2 Crónicas", "Esdras", "Nehemías", "Ester", "Job",
    "Salmos", "Proverbios", "Eclesiastés", "Cantares", "Isaías", "Jeremías", "Lamentaciones", "Ezequiel",
    "Daniel", "Oseas", "Joel", "Amós", "Abdías", "Jonás", "Miqueas", "Nahúm", "Habacuc", "Sofonías", "Hageo",
    "Zacarías", "Malaquías", "Mateo", "Marcos", "Lucas", "Juan", "Hechos", "Romanos", "1 Corintios",
    "2 Corintios", "Gálatas", "Efesios", "Filipenses", "Colosenses", "1 Tesalonicenses", "2 Tesalonicenses",
    "1 Timoteo", "2 Timoteo", "Tito", "Filemón", "Hebreos", "Santiago", "1 Pedro", "2 Pedro", "1 Juan",
    "2 Juan", "3 Juan", "Judas", "Apocalipsis"]

SOURCES = {
    "SpaRV.json": "https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/SpaRV.json",
    "ro_vdc.json": "https://raw.githubusercontent.com/thiagobodruk/bible/master/json/ro_vdc.json",
    "KJV.json": "https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/KJV.json",
}


def fetch(work):
    os.makedirs(work, exist_ok=True)
    for name, url in SOURCES.items():
        path = os.path.join(work, name)
        if not os.path.exists(path) or os.path.getsize(path) < 1000:
            print("downloading", url)
            urllib.request.urlretrieve(url, path)


def tidy(text):
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([,.;:!?»”])", r"\1", text)  # "pământul ." -> "pământul."
    text = re.sub(r"([„«“])\s+", r"\1", text)
    return text


def put(books, code, chapter, verse, text):
    book = books[code]
    while len(book["chapters"]) < chapter:
        book["chapters"].append([])
    verses = book["chapters"][chapter - 1]
    while len(verses) < verse:
        verses.append("")
    verses[verse - 1] = text


def empty_books(names):
    return {code: {"code": code, "name": names[i], "chapters": []} for i, code in enumerate(USFM)}


def scrollmapper(path, names=None):
    data = json.load(open(path, encoding="utf-8"))["books"]
    assert len(data) == 66
    books = []
    for i, (code, book) in enumerate(zip(USFM, data)):
        chapters = []
        for ch in book["chapters"]:
            verses = []
            for v in ch["verses"]:
                while len(verses) < v["verse"] - 1:
                    verses.append("")
                text = tidy(v["text"])
                # Drop caps in the source: "EN el principio" -> "En el principio".
                m = re.match(r"^([A-ZÁÉÍÓÚÑ]{2,})(\s+[a-záéíóúñ])", text)
                if v["verse"] == 1 and m:
                    text = m.group(1)[0] + m.group(1)[1:].lower() + text[len(m.group(1)):]
                verses.append(text)
            chapters.append(verses)
        books.append({"code": code, "name": names[i] if names else book["name"].strip(), "chapters": chapters})
    return books


def rva(work):
    return {
        "id": "rva", "abbreviation": "RVA", "name": "Reina-Valera Antigua (1909)", "language": "es",
        "license": "Public domain", "attribution": "", "source": "Reina-Valera 1909",
        "books": scrollmapper(os.path.join(work, "SpaRV.json"), SPANISH),
    }


def vdc(work):
    data = json.load(open(os.path.join(work, "ro_vdc.json"), encoding="utf-8-sig"))
    assert len(data) == 66
    books = []
    for code, book in zip(USFM, data):
        chapters = [[tidy(v) for v in ch] for ch in book["chapters"]]
        books.append({"code": code, "name": book["name"].strip(), "chapters": chapters})
    return {
        "id": "vdc", "abbreviation": "VDC", "name": "Biblia Cornilescu (1924)", "language": "ro",
        "license": "Public domain", "attribution": "", "source": "Dumitru Cornilescu, 1924",
        "books": books,
    }


def kjv(work):
    return {
        "id": "kjv", "abbreviation": "KJV", "name": "King James Version (1769)", "language": "en",
        "license": "Public domain", "attribution": "", "source": "King James Version, 1769 Oxford edition",
        "books": scrollmapper(os.path.join(work, "KJV.json")),
    }


def main():
    work, out = sys.argv[1], sys.argv[2]
    fetch(work)
    os.makedirs(out, exist_ok=True)
    for build in (rva, vdc, kjv):
        bible = build(work)
        verses = sum(len(c) for b in bible["books"] for c in b["chapters"])
        empty = sum(1 for b in bible["books"] for c in b["chapters"] for v in c if not v)
        raw = json.dumps(bible, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        path = os.path.join(out, f"{bible['id']}.json.gz")
        with open(path, "wb") as f:
            f.write(gzip.compress(raw, 9, mtime=0))
        print(f"{bible['abbreviation']}: {verses} verses ({empty} empty), {os.path.getsize(path) // 1024} KB")


if __name__ == "__main__":
    main()
