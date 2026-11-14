//! Canonical books (USFM codes) with names and common abbreviations in the languages the
//! reference search understands out of the box. A Bible's own book names are always
//! understood too, so imported Bibles in other languages work with their own names.

pub struct BookInfo {
    pub code: &'static str,
    /// OSIS id (used by OSIS files).
    pub osis: &'static str,
    pub en: &'static str,
    pub es: &'static str,
    pub ro: &'static str,
    /// Extra abbreviations (any language), without the leading book number.
    pub aliases: &'static [&'static str],
}

macro_rules! b {
    ($code:literal, $osis:literal, $en:literal, $es:literal, $ro:literal, [$($a:literal),*]) => {
        BookInfo { code: $code, osis: $osis, en: $en, es: $es, ro: $ro, aliases: &[$($a),*] }
    };
}

pub static BOOKS: &[BookInfo] = &[
    b!("GEN", "Gen", "Genesis", "Génesis", "Geneza", ["gn", "ge", "gen"]),
    b!("EXO", "Exod", "Exodus", "Éxodo", "Exodul", ["ex", "exod", "exo"]),
    b!("LEV", "Lev", "Leviticus", "Levítico", "Leviticul", ["lv", "lev"]),
    b!("NUM", "Num", "Numbers", "Números", "Numeri", ["nm", "nu", "num"]),
    b!("DEU", "Deut", "Deuteronomy", "Deuteronomio", "Deuteronomul", ["dt", "deut", "deu"]),
    b!("JOS", "Josh", "Joshua", "Josué", "Iosua", ["jos", "josh", "ios"]),
    b!("JDG", "Judg", "Judges", "Jueces", "Judecători", ["jdg", "judg", "jue", "jc"]),
    b!("RUT", "Ruth", "Ruth", "Rut", "Rut", ["rt", "ru"]),
    b!("1SA", "1Sam", "1 Samuel", "1 Samuel", "1 Samuel", ["s", "sa", "sam", "sm"]),
    b!("2SA", "2Sam", "2 Samuel", "2 Samuel", "2 Samuel", ["s", "sa", "sam", "sm"]),
    b!("1KI", "1Kgs", "1 Kings", "1 Reyes", "1 Împărați", ["k", "ki", "kgs", "r", "re", "rey", "imp", "regi"]),
    b!("2KI", "2Kgs", "2 Kings", "2 Reyes", "2 Împărați", ["k", "ki", "kgs", "r", "re", "rey", "imp", "regi"]),
    b!("1CH", "1Chr", "1 Chronicles", "1 Crónicas", "1 Cronici", ["ch", "chr", "cr", "cro", "cron", "par"]),
    b!("2CH", "2Chr", "2 Chronicles", "2 Crónicas", "2 Cronici", ["ch", "chr", "cr", "cro", "cron", "par"]),
    b!("EZR", "Ezra", "Ezra", "Esdras", "Ezra", ["ezr", "esd"]),
    b!("NEH", "Neh", "Nehemiah", "Nehemías", "Neemia", ["ne", "neh", "neem"]),
    b!("EST", "Esth", "Esther", "Ester", "Estera", ["est", "esth"]),
    b!("JOB", "Job", "Job", "Job", "Iov", ["jb"]),
    b!("PSA", "Ps", "Psalms", "Salmos", "Psalmii", ["ps", "psa", "psalm", "sal", "sl", "salmo", "psalmul"]),
    b!("PRO", "Prov", "Proverbs", "Proverbios", "Proverbele", ["pr", "prov", "prv", "pro"]),
    b!("ECC", "Eccl", "Ecclesiastes", "Eclesiastés", "Eclesiastul", ["ec", "ecc", "eccl", "qo", "ecl"]),
    b!("SNG", "Song", "Song of Solomon", "Cantares", "Cântarea cântărilor", ["song", "sos", "ss", "cant", "cnt", "ct", "cantarea"]),
    b!("ISA", "Isa", "Isaiah", "Isaías", "Isaia", ["is", "isa"]),
    b!("JER", "Jer", "Jeremiah", "Jeremías", "Ieremia", ["jr", "jer", "ier"]),
    b!("LAM", "Lam", "Lamentations", "Lamentaciones", "Plângerile lui Ieremia", ["lm", "lam", "plang", "plangeri"]),
    b!("EZK", "Ezek", "Ezekiel", "Ezequiel", "Ezechiel", ["ez", "ezk", "ezek", "eze", "ezec"]),
    b!("DAN", "Dan", "Daniel", "Daniel", "Daniel", ["dn", "da"]),
    b!("HOS", "Hos", "Hosea", "Oseas", "Osea", ["ho", "hos", "os"]),
    b!("JOL", "Joel", "Joel", "Joel", "Ioel", ["jl", "joe", "ioel"]),
    b!("AMO", "Amos", "Amos", "Amós", "Amos", ["am"]),
    b!("OBA", "Obad", "Obadiah", "Abdías", "Obadia", ["ob", "obad", "abd"]),
    b!("JON", "Jonah", "Jonah", "Jonás", "Iona", ["jnh", "jon"]),
    b!("MIC", "Mic", "Micah", "Miqueas", "Mica", ["mi", "mic"]),
    b!("NAM", "Nah", "Nahum", "Nahúm", "Naum", ["na", "nah"]),
    b!("HAB", "Hab", "Habakkuk", "Habacuc", "Habacuc", ["hb", "hab"]),
    b!("ZEP", "Zeph", "Zephaniah", "Sofonías", "Țefania", ["zp", "zep", "zeph", "sof", "tef"]),
    b!("HAG", "Hag", "Haggai", "Hageo", "Hagai", ["hg", "hag"]),
    b!("ZEC", "Zech", "Zechariah", "Zacarías", "Zaharia", ["zc", "zec", "zech", "zac", "zah"]),
    b!("MAL", "Mal", "Malachi", "Malaquías", "Maleahi", ["ml", "mal"]),
    b!("MAT", "Matt", "Matthew", "Mateo", "Matei", ["mt", "mat", "matt"]),
    b!("MRK", "Mark", "Mark", "Marcos", "Marcu", ["mk", "mr", "mrk", "mc", "mar"]),
    b!("LUK", "Luke", "Luke", "Lucas", "Luca", ["lk", "lc", "luk", "lu"]),
    b!("JHN", "John", "John", "Juan", "Ioan", ["jn", "jhn", "joh", "in"]),
    b!("ACT", "Acts", "Acts", "Hechos", "Faptele apostolilor", ["ac", "act", "hch", "hech", "fa", "fapte"]),
    b!("ROM", "Rom", "Romans", "Romanos", "Romani", ["ro", "rm", "rom"]),
    b!("1CO", "1Cor", "1 Corinthians", "1 Corintios", "1 Corinteni", ["co", "cor"]),
    b!("2CO", "2Cor", "2 Corinthians", "2 Corintios", "2 Corinteni", ["co", "cor"]),
    b!("GAL", "Gal", "Galatians", "Gálatas", "Galateni", ["ga", "gl", "gal"]),
    b!("EPH", "Eph", "Ephesians", "Efesios", "Efeseni", ["ep", "eph", "ef"]),
    b!("PHP", "Phil", "Philippians", "Filipenses", "Filipeni", ["php", "phil", "flp", "fil", "filip"]),
    b!("COL", "Col", "Colossians", "Colosenses", "Coloseni", ["cl", "col"]),
    b!("1TH", "1Thess", "1 Thessalonians", "1 Tesalonicenses", "1 Tesaloniceni", ["th", "thes", "thess", "ts", "tes"]),
    b!("2TH", "2Thess", "2 Thessalonians", "2 Tesalonicenses", "2 Tesaloniceni", ["th", "thes", "thess", "ts", "tes"]),
    b!("1TI", "1Tim", "1 Timothy", "1 Timoteo", "1 Timotei", ["ti", "tm", "tim"]),
    b!("2TI", "2Tim", "2 Timothy", "2 Timoteo", "2 Timotei", ["ti", "tm", "tim"]),
    b!("TIT", "Titus", "Titus", "Tito", "Tit", ["tt", "tit"]),
    b!("PHM", "Phlm", "Philemon", "Filemón", "Filimon", ["phm", "phlm", "flm", "filem", "filim"]),
    b!("HEB", "Heb", "Hebrews", "Hebreos", "Evrei", ["hb", "heb", "he", "evr"]),
    b!("JAS", "Jas", "James", "Santiago", "Iacov", ["jas", "jm", "stg", "sant", "iac"]),
    b!("1PE", "1Pet", "1 Peter", "1 Pedro", "1 Petru", ["p", "pe", "pet", "pt", "pd"]),
    b!("2PE", "2Pet", "2 Peter", "2 Pedro", "2 Petru", ["p", "pe", "pet", "pt", "pd"]),
    b!("1JN", "1John", "1 John", "1 Juan", "1 Ioan", ["jn", "jhn", "jo", "joh", "in", "io"]),
    b!("2JN", "2John", "2 John", "2 Juan", "2 Ioan", ["jn", "jhn", "jo", "joh", "in", "io"]),
    b!("3JN", "3John", "3 John", "3 Juan", "3 Ioan", ["jn", "jhn", "jo", "joh", "in", "io"]),
    b!("JUD", "Jude", "Jude", "Judas", "Iuda", ["jud", "jd", "jds"]),
    b!("REV", "Rev", "Revelation", "Apocalipsis", "Apocalipsa", ["rv", "rev", "ap", "apoc", "apc"]),
    // Deuterocanonical books (only present in some Bibles).
    b!("TOB", "Tob", "Tobit", "Tobías", "Tobit", ["tb", "tob"]),
    b!("JDT", "Jdt", "Judith", "Judit", "Iudita", ["jdt", "jdth"]),
    b!("ESG", "EsthGr", "Esther (Greek)", "Ester (griego)", "Estera (greacă)", ["esg"]),
    b!("WIS", "Wis", "Wisdom", "Sabiduría", "Înțelepciunea", ["ws", "wis", "sab"]),
    b!("SIR", "Sir", "Sirach", "Eclesiástico", "Ecleziasticul", ["sir", "ecclus", "eclo"]),
    b!("BAR", "Bar", "Baruch", "Baruc", "Baruh", ["ba", "bar"]),
    b!("1MA", "1Macc", "1 Maccabees", "1 Macabeos", "1 Macabei", ["ma", "mac", "macc"]),
    b!("2MA", "2Macc", "2 Maccabees", "2 Macabeos", "2 Macabei", ["ma", "mac", "macc"]),
];

pub fn info(code: &str) -> Option<&'static BookInfo> {
    BOOKS.iter().find(|b| b.code.eq_ignore_ascii_case(code))
}

/// Canonical position (for sorting imported books).
pub fn order(code: &str) -> usize {
    BOOKS.iter().position(|b| b.code.eq_ignore_ascii_case(code)).unwrap_or(usize::MAX)
}

pub fn from_osis(osis: &str) -> Option<&'static str> {
    BOOKS.iter().find(|b| b.osis.eq_ignore_ascii_case(osis)).map(|b| b.code)
}

/// The usual Zefania numbering: 1-66 Protestant canon, then the deuterocanon.
pub fn from_number(n: usize) -> Option<&'static str> {
    if (1..=66).contains(&n) {
        return Some(BOOKS[n - 1].code);
    }
    match n {
        67 => Some("TOB"),
        68 => Some("JDT"),
        69 => Some("ESG"),
        70 => Some("WIS"),
        71 => Some("SIR"),
        72 => Some("BAR"),
        73 => Some("1MA"),
        74 => Some("2MA"),
        _ => None,
    }
}

/// Default book name in a language (2-letter code), falling back to English.
pub fn name_in(code: &str, language: &str) -> Option<&'static str> {
    let b = info(code)?;
    Some(match short_language(language) {
        "es" => b.es,
        "ro" => b.ro,
        _ => b.en,
    })
}

/// "spa" / "es-ES" / "ES" -> "es".
pub fn short_language(language: &str) -> &'static str {
    let l = language.trim().to_ascii_lowercase();
    let base = l.split(['-', '_']).next().unwrap_or("");
    match base {
        "es" | "spa" => "es",
        "ro" | "ron" | "rum" | "mo" => "ro",
        "en" | "eng" => "en",
        _ => "other",
    }
}

/// Finds a book code by any name: USFM code, OSIS id, or a name in any known language.
pub fn by_any_name(name: &str) -> Option<&'static str> {
    let n = super::normalize(name).replace(' ', "");
    BOOKS
        .iter()
        .find(|b| {
            [b.code, b.osis, b.en, b.es, b.ro]
                .iter()
                .any(|x| super::normalize(x).replace(' ', "") == n)
        })
        .map(|b| b.code)
}
