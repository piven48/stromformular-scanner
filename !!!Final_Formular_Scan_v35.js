(async function () {
  "use strict";
  var allFields = new Map();
  var scanCount = 0;
  var startTime = Date.now();
  var MAX_RUNTIME = 10 * 60 * 1000; // 10 Min fuer Multi-Page
  var errors = [];
  var actionsLog = [];

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function waitForStable() {
    // FIX v39 #1: 300ms Extra-Puffer nach letzter DOM-Mutation.
    // Verhindert Race Condition wenn FMS nach einem Klick mehrere
    // sequenzielle AJAX-Responses schickt (jede loest MutationObserver
    // aus und resettet den 800ms-Timer). Der Puffer stellt sicher dass
    // auch die letzte Response vollstaendig gerendert ist bevor
    // scanFields() aufgerufen wird.
    return new Promise(function (resolve) {
      var settled = false;
      function done() {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(hardLimit);
        setTimeout(resolve, 300); // Extra-Puffer nach letzter Mutation
      }
      var timeout = setTimeout(done, 2500);
      var observer = new MutationObserver(function () {
        clearTimeout(timeout);
        timeout = setTimeout(done, 800);
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      var hardLimit = setTimeout(done, 4000);
    });
  }

  function log(msg) {
    var elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log("%c[" + elapsed + "s] " + msg, "color:#0066cc;font-size:13px;");
  }

  function isTimedOut() { return (Date.now() - startTime) > MAX_RUNTIME; }

  var FIELD_SELECTOR = "input,select,textarea,[role=checkbox],[role=radio],[role=combobox],[role=textbox],[role=listbox],[role=spinbutton],div.textbox,div.combobox,div[id][contenteditable]";
  var IMPORTANT_HIDDEN_PATTERNS = ["reg_", "register", "regeintrag"];

  // ------------------------------------------------
  // LABEL_MAP: Korrekte Bezeichnungen aus dem
  // Erfassungsbogen 1400 (Stand 2025-05-09).
  // Hat Vorrang vor der DOM-Erkennung.
  // ------------------------------------------------
  var LABEL_MAP = {
    "Vorblatt_k_antrag1": "Der Antrag wird in eigenem/fremdem Namen abgegeben",
    "Vorblatt_k_antrag2": "Der Antrag wird in eigenem/fremdem Namen abgegeben",
    "Vorblatt_hza": "An das Hauptzollamt",
    "Vorblatt_name_firma": "Name bzw. Firmenbezeichnung",
    "Vorblatt_rechtsform": "Rechtsform",
    "Vorblatt_gruendung": "Gründungsdatum",
    "Vorblatt_land": "Land",
    "Vorblatt_plz": "Postleitzahl",
    "Vorblatt_plz_de": "Postleitzahl",
    "Vorblatt_ort": "Ort",
    "Vorblatt_strasse": "Straße",
    "Vorblatt_haus_nr": "Hausnummer",
    "Vorblatt_ortsteil": "Ortsteil",
    "Vorblatt_adesszusatz": "Adresszusatz",
    "Vorblatt_beteiligtennummer": "Beteiligten-Nr. (VVSt)",
    "Vorblatt_unternehmensnummer": "Unternehmensnummer",
    "Vorblatt_e_mail3": "E-Mail Adresse",
    "Vorblatt_telefon3": "Telefonnummer",
    "Vorblatt_k_register_ja": "Haben sich seit der letzten Antragstellung Änderungen ergeben oder handelt es sich um einen Erstantrag?",
    "Vorblatt_k_register_nein": "Haben sich seit der letzten Antragstellung Änderungen ergeben oder handelt es sich um einen Erstantrag?",
    "Vorblatt_reg_art": "Registerart",
    "Vorblatt_reg_nr": "Registernummer",
    "Vorblatt_reg_gericht": "Registergericht",
    "Vorblatt_k_postfach_ja": "Abweichende Postfachadresse?",
    "Vorblatt_k_postfach_nein": "Abweichende Postfachadresse?",
    "Vorblatt_k_post_aenderung_ja": "Haben sich seit der letzten Antragstellung Änderungen ergeben oder handelt es sich um einen Erstantrag?",
    "Vorblatt_k_post_aenderung_nein": "Haben sich seit der letzten Antragstellung Änderungen ergeben oder handelt es sich um einen Erstantrag?",
    "Vorblatt_plz_de_post": "Postleitzahl",
    "Vorblatt_ort_post": "Ort",
    "Vorblatt_postfach_post": "Postfach",
    "Vorblatt_k_Sitz_geschaeft_ja": "Abweichender Sitz der Geschäftsleitung?",
    "Vorblatt_k_Sitz_geschaeft_nein": "Abweichender Sitz der Geschäftsleitung?",
    "Vorblatt_k_geschaeft_aenderung_ja": "Haben sich seit der letzten Antragstellung Änderungen ergeben oder handelt es sich um einen Erstantrag?",
    "Vorblatt_k_geschaeft_aenderung_nein": "Haben sich seit der letzten Antragstellung Änderungen ergeben oder handelt es sich um einen Erstantrag?",
    "Vorblatt_name_geschaeftsleitung": "Name am Sitz der Geschäftsleitung",
    "Vorblatt_land_geschaeftsleitung": "Land",
    "Vorblatt_plz_geschaeftsleitung": "Postleitzahl",
    "Vorblatt_ort_geschaeftsleitung": "Ort",
    "Vorblatt_strasse_geschaeftsleitung": "Straße",
    "Vorblatt_haus_nr_geschaeftsleitung": "Hausnummer",
    "Vorblatt_ortsteil_gechaeftsleitung": "Ortsteil",
    "Vorblatt_adesszusatz_geschaeftsleitung": "Adresszusatz",
    "Vorblatt_k_Hauptbuchhaltung_ja": "Sind Sie zum Führen von Büchern verpflichtet?",
    "Vorblatt_k_Hauptbuchhaltung_nein": "Sind Sie zum Führen von Büchern verpflichtet?",
    "Vorblatt_k_hauptbuchhaltung_ort_ja": "Ist der Ort Ihrer Hauptbuchhaltung unter einer anderen als der Unternehmensanschrift geführt?",
    "Vorblatt_k_hauptbuchhaltung_ort_nein": "Ist der Ort Ihrer Hauptbuchhaltung unter einer anderen als der Unternehmensanschrift geführt?",
    "Vorbaltt_k_hauptbuchhaltung_aenderung_ja": "Haben sich seit der letzten Antragstellung Änderungen ergeben oder handelt es sich um einen Erstantrag",
    "Vorbaltt_k_hauptbuchhaltung_aenderung_nein": "Haben sich seit der letzten Antragstellung Änderungen ergeben oder handelt es sich um einen Erstantrag",
    "Vorblatt_name_hauptbuchhaltung": "Name am Ort der Hauptbuchhaltung",
    "Vorblatt_land_hauptbuchhaltung": "Land",
    "Vorblatt_plz_hauptbuchhaltung": "Postleitzahl",
    "Vorblatt_plz_de_hauptbuchhaltung": "Postleitzahl",
    "Vorblatt_ort_hauptbuchhaltung": "Ort",
    "Vorblatt_strasse_hauptbuchhaltung": "Straße",
    "Vorblatt_haus_nr_hauptbuchhaltung": "Hausnummer",
    "Vorblatt_ortsteil_hauptbuchhaltung": "Ortsteil",
    "Vorblatt_adesszusatz_hauptbuchhaltung": "Adresszusatz",
    "Vorblatt_k_empfang_ja": "Eine andere natürliche oder juristische Person ist zum Empfang bevollmächtigt.",
    "Vorblatt_k_empfang_nein": "Eine andere natürliche oder juristische Person ist zum Empfang bevollmächtigt.",
    "Vorblatt_k_antragstellung_ja": "Haben sich seit der letzten Antragstellung Änderungen ergeben oder handelt es sich um einen Erstantrag?",
    "Vorblatt_k_antragstellung_nein": "Haben sich seit der letzten Antragstellung Änderungen ergeben oder handelt es sich um einen Erstantrag?",
    "Vorblatt_k_rechtsbereich_ja": "Vollumfängliche Empfangsvollmacht für alle Rechtsbereiche?",
    "Vorblatt_k_rechtsbereich_nein": "Vollumfängliche Empfangsvollmacht für alle Rechtsbereiche?",
    "Vorblatt_bereich2_1": "Alkoholsteuer, Schaumweinsteuer, Zwischenerzeugnissteuer und Kaffeesteuer",
    "Vorblatt_bereich2_2": "Alkopopsteuer",
    "Vorblatt_bereich2_3": "Biersteuer",
    "Vorblatt_bereich2_4": "Energiesteuer",
    "Vorblatt_bereich2_5": "Luftverkehrsteuer",
    "Vorblatt_bereich2_6": "Stromsteuer",
    "Vorblatt_bereich2_7": "Tabaksteuer",
    "Vorblatt_bereich2_8": "Weinsteuer",
    "Vorblatt_bereich2_einschraenkungen": "weitere Einschränkungen",
    "Vorblatt_name_firma2": "Name bzw. Firmenbezeichnung",
    "Vorblatt_rechtsform2": "Rechtsform",
    "Vorblatt_gruendung2": "Gründungsdatum",
    "Vorblatt_land2": "Land",
    "Vorblatt_plz2": "Postleitzahl",
    "Vorblatt_plz_de2": "Postleitzahl",
    "Vorblatt_ort2": "Ort",
    "Vorblatt_strasse2": "Straße",
    "Vorblatt_haus_nr2": "Hausnummer",
    "Vorblatt_ortsteil2": "Ortsteil",
    "Vorblatt_adresszusatz2": "Adresszusatz",
    "Vorblatt_nr3": "Beteiligten-Nr. (VVSt) des Empfangsbevollmächtigten (falls vorhanden)",
    "Vorblatt_e_mail2": "E-Mail Adresse",
    "Vorblatt_telefon2": "Telefonnummer",
    "Vorblatt_k_regeintrag_ja": "Haben sicht seit der letzten Antragstellung Änderungen ergeben oder handelt es sich um einen Erstantrag?",
    "Vorblatt_k_regeintrag_nein": "Haben sicht seit der letzten Antragstellung Änderungen ergeben oder handelt es sich um einen Erstantrag?",
    "Vorblatt_k_regeintrag_vertr_ja": "Haben sich seit der letzten Antragstellung Änderungen ergeben oder handelt es sich um einen Erstantrag?",
    "Vorblatt_k_regeintrag_vertr_nein": "Haben sich seit der letzten Antragstellung Änderungen ergeben oder handelt es sich um einen Erstantrag?",
    "Vorblatt_reg_art2": "Registerart",
    "Vorblatt_reg_nr2": "Registernummer",
    "Vorblatt_reg_gericht2": "Registergericht",
    "Vorblatt_reg_art3": "Registerart",
    "Vorblatt_reg_nr3": "Registernummer",
    "Vorblatt_reg_gericht3": "Registergericht",

    // ---- Seite 1: Ansprechperson & Kontakt ----
    "ansprechpartner": "Ansprechperson",
    "telefon": "Telefon",
    "telefax": "Telefax",
    "email": "E-Mail-Adresse",
    "internet": "Internet-Adresse",
    "mastrnr": "MaStR-Nr. als Marktakteur (soweit vorhanden)",

    // ---- Seite 1: Anmeldung (3.) ----
    "k_j1": "der Stromsteuer einschließlich ggf. steuerfreier Strommengen",
    "k_n1": "der Stromsteuer einschließlich ggf. steuerfreier Strommengen",
    "k_j2": "der steuerfreien Strommengen nach § 4 Abs. 6 StromStV",
    "k_n2": "der steuerfreien Strommengen nach § 4 Abs. 6 StromStV",

    // ---- Seite 1: Veranlagungszeitraum (4.) ----
    "veranlagungszeitraum": "Veranlagungszeitraum",
    "kassenzeichen": "Kassenzeichen",

    // ---- Seite 1: Steueranmeldung (5.) ----
    "k_j3": "Es handelt sich um die erstmalige Steueranmeldung für den oben genannten Veranlagungszeitraum.",
    "k_n3": "Es handelt sich um die erstmalige Steueranmeldung für den oben genannten Veranlagungszeitraum.",
    "k_j4": "Es handelt sich um eine Berichtigung der Steueranmeldung für den oben genannten Veranlagungszeitraum.",
    "k_n4": "Es handelt sich um eine Berichtigung der Steueranmeldung für den oben genannten Veranlagungszeitraum.",
    "datum1": "Datum der Steueranmeldung, auf welche sich die Berichtigung bezieht",
    "k_j5": "In der Steueranmeldung sind Strommengen enthalten, die im rollierenden Verfahren nach § 8 Abs. 4a StromStG angemeldet bzw. berichtigt werden",
    "k_n5": "In der Steueranmeldung sind Strommengen enthalten, die im rollierenden Verfahren nach § 8 Abs. 4a StromStG angemeldet bzw. berichtigt werden",

    // ---- Seite 1: Veranlagungszeitraum (6.) ----
    "k11": "Veranlagungszeitraum ist das Kalenderjahr.",
    "k12": "Veranlagungszeitraum ist das Kalenderjahr.",
    "datum2": "Die Steueranmeldung erfolgt für das Kalenderjahr",
    "k13": "Es bestand für das gesamte Kalenderjahr eine Steuerpflicht",
    "k14": "Es bestand für das gesamte Kalenderjahr eine Steuerpflicht",
    "datum3": "Die Steuerpflicht bestand vom",
    "datum4": "Die Steuerpflicht bestand bis",
    "k15": "Veranlagungszeitraum ist der Kalendermonat",
    "k16": "Veranlagungszeitraum ist der Kalendermonat",
    "k17": "Es ist bis zum 31. Dezember des Vorjahres eine Erklärung beim zuständigen Hauptzollamt darüber abgegeben worden, dass die Steueranmeldung monatlich abgegeben werden soll.",
    "k18": "Es ist bis zum 31. Dezember des Vorjahres eine Erklärung beim zuständigen Hauptzollamt darüber abgegeben worden, dass die Steueranmeldung monatlich abgegeben werden soll.",
    "datum5": "Die Steueranmeldung erfolgt für den Kalendermonat",
    "k19": "Veranlagungszeitraum ist abweichend von einem Kalenderjahr und einem Kalendermonat.",
    "k20": "Veranlagungszeitraum ist abweichend von einem Kalenderjahr und einem Kalendermonat.",
    "datum6": "Veranlagungszeitraum ist der Zeitraum vom",
    "datum7": "Veranlagungszeitraum ist der Zeitraum bis",
    "k21": "Es handelt es sich um eine Berichtigung nach § 153 AO.",
    "k22": "Es handelt es sich um eine Berichtigung nach § 153 AO.",
    "k23": "Die Steueranmeldung ist unverzüglich abzugeben.",
    "k24": "Die Steueranmeldung ist unverzüglich abzugeben.",
    "k25": "Der Strom wurde ohne Erlaubnis nach § 4 Abs. 1 StromStG oder steuerbegünstigt an einen Nichtberechtigten nach § 9 Abs. 8 StromStG geleistet",
    "k26": "Der Strom wurde ohne Erlaubnis nach § 4 Abs. 1 StromStG oder steuerbegünstigt an einen Nichtberechtigten nach § 9 Abs. 8 StromStG geleistet",
    "k27": "Der Strom wurde ohne Erlaubnis nach § 4 Abs. 1 StromStG zum Selbstverbrauch entnommen",
    "k28": "Der Strom wurde ohne Erlaubnis nach § 4 Abs. 1 StromStG zum Selbstverbrauch entnommen",
    "k29": "Der Strom wurde widerrechtlich nach § 6 StromStG entnommen.",
    "k30": "Der Strom wurde widerrechtlich nach § 6 StromStG entnommen.",
    "k31": "Der Strom wurde zweckwidrig nach § 9 Abs. 6 StromStG entnommen.",
    "k32": "Der Strom wurde zweckwidrig nach § 9 Abs. 6 StromStG entnommen.",

    // ---- Seite 1: Anmeldung steuerfreie Strommengen (7.) ----
    "datum8": "Die Anmeldung erfolgt für das Kalenderjahr",
    "k33": "Es handelt sich um die Berichtigung einer Anmeldung",
    "k34": "Es handelt sich um die Berichtigung einer Anmeldung",

    // ---- Seite 1: Zahlung (8.) ----
    "k35": "Den ggf. anfallenden Steuerbetrag bitte ich mittels erteiltem SEPA-Firmenlastschriftmandat einzuziehen",
    "k36": "Den ggf. anfallenden Steuerbetrag bitte ich mittels erteiltem SEPA-Firmenlastschriftmandat einzuziehen",
    "manref": "Mandatsreferenznummer",
    "k37": "Den ggf. anfallenden Steuerbetrag entrichte ich auf andere Weise unter Wahrung der Fälligkeit",
    "k38": "Den ggf. anfallenden Steuerbetrag entrichte ich auf andere Weise unter Wahrung der Fälligkeit",
    "Kontoinhaber": "Kontoinhaber",
    "iban_land": "IBAN Land",
    "iban_de": "IBAN Ziffern",
    "bic": "BIC",

    // ---- Seite 1: Berechnung / Strommengen (9.) ----
    "menge1": "Leistung an Dritte zum Regelsteuersatz gem. § 3 StromStG (Menge in MWh)",
    "bet1": "Leistung an Dritte zum Regelsteuersatz gem. § 3 StromStG (Steuerbetrag in Euro, Cent)",
    "menge2": "Selbstverbrauch zum Regelsteuersatz gem. § 3 StromStG (Menge in MWh)",
    "bet2": "Selbstverbrauch zum Regelsteuersatz gem. § 3 StromStG (Steuerbetrag in Euro, Cent)",
    "menge3": "Fahrbetrieb (ermäßigter Steuersatz gem. § 9 Abs. 2 StromStG) (Menge in MWh)",
    "bet3": "Fahrbetrieb (ermäßigter Steuersatz gem. § 9 Abs. 2 StromStG) (Steuerbetrag in Euro, Cent)",
    "menge4": "Differenzversteuerung Fahrbetrieb – Stromabgabe (Differenzsteuersatz gem. § 13a Abs. 1 StromStV) (Menge in MWh)",
    "bet4": "Differenzversteuerung Fahrbetrieb – Stromabgabe (Differenzsteuersatz gem. § 13a Abs. 1 StromStV) (Steuerbetrag in Euro, Cent)",
    "menge5": "Differenzversteuerung Fahrbetrieb – Entnahme zum Selbstverbrauch (Differenzsteuersatz gem. § 13a Abs. 2 StromStV) (Menge in MWh)",
    "bet5": "Differenzversteuerung Fahrbetrieb – Entnahme zum Selbstverbrauch (Differenzsteuersatz gem. § 13a Abs. 2 StromStV) (Steuerbetrag in Euro, Cent)",
    "menge6": "Landstrom (ermäßigter Steuersatz gem. § 9 Abs. 3 StromStG) (Menge in MWh)",
    "bet6": "Landstrom (ermäßigter Steuersatz gem. § 9 Abs. 3 StromStG) (Steuerbetrag in Euro, Cent)",
    "menge7": "Steuerfreie Entnahme von Strom aus erneuerbaren Energieträgern am Ort der Erzeugung zum Selbstverbrauch nach § 9 Abs. 1 Nr. 1 StromStG (Menge in MWh)",
    "menge8": "Steuerfreie Entnahme von Strom zur Stromerzeugung nach § 9 Abs. 1 Nr. 2 StromStG (Menge in MWh)",
    "menge9": "Steuerfreie Leistung von Strom zur Stromerzeugung an Letztverbraucher nach § 9 Abs. 1 Nr. 2 StromStG (Menge in MWh)",
    "menge10": "Steuerfreie Entnahme von Strom aus erneuerbaren Energieträgern im räumlichen Zusammenhang zum Selbstverbrauch nach § 9 Abs. 1 Nr. 3 Buchst. a StromStG – bis zu 2 MW (Menge in MWh)",
    "menge11": "Steuerfreie Entnahme von Strom aus hocheffizienten KWK-Anlagen im räumlichen Zusammenhang zum Selbstverbrauch nach § 9 Abs. 1 Nr. 3 Buchst. a StromStG – bis zu 2 MW (Menge in MWh)",
    "menge12": "Steuerfreie Leistung von Strom aus erneuerbaren Energieträgern im räumlichen Zusammenhang an Letztverbraucher nach § 9 Abs. 1 Nr. 3 Buchst. b StromStG – bis zu 2 MW (Menge in MWh)",
    "menge13": "Steuerfreie Leistung von Strom aus erneuerbaren Energieträgern im räumlichen Zusammenhang an Letztverbraucher nach § 9 Abs. 1 Nr. 3 Buchst. b StromStG – bis zu 2 MW Contracting (Menge in MWh)",
    "menge14": "Steuerfreie Leistung von Strom aus hocheffizienten KWK-Anlagen im räumlichen Zusammenhang an Letztverbraucher nach § 9 Abs. 1 Nr. 3 Buchst. b StromStG – bis zu 2 MW (Menge in MWh)",
    "menge15": "Steuerfreie Leistung von Strom aus hocheffizienten KWK-Anlagen im räumlichen Zusammenhang an Letztverbraucher nach § 9 Abs. 1 Nr. 3 Buchst. b StromStG – bis zu 2 MW Contracting (Menge in MWh)",
    "menge16": "Steuerfreier Strom aus Notstromanlagen nach § 9 Abs. 1 Nr. 4 StromStG (Menge in MWh)",
    "menge17": "Steuerfreier Strom auf Wasser-/Luftfahrzeugen bzw. in Schienenfahrzeugen nach § 9 Abs. 1 Nr. 5 StromStG (Menge in MWh)",
    "menge18": "Steuerfreie Entnahme von Strom am Ort der Erzeugung nach § 9 Abs. 1 Nr. 6 StromStG – bis zu 2 MW (Menge in MWh)",
    "menge19": "Steuerfreie Strommengen (weitere) (Menge in MWh)",
    "summe1": "Summe (Steuerbetrag)",
    "voraus": "ggf. geleistete Vorauszahlungen (§ 8 Abs. 7 StromStG)",
    "BETRAG": "Gesamt zu entrichten / zu entlasten (Summe – ggf. geleistete Vorauszahlungen)",

    // ---- Seite 1: Anlagen (9.6) ----
    "k39": "Diesem Formular sind Anlagen beigefügt",
    "k40": "Diesem Formular sind Anlagen beigefügt",
    "freitext2": "Freitextfeld für Erläuterungen",

    // ---- Seite 2: Erklärung / Marktprämie ----
    "ke_j1": "Für die steuerfreien Strommengen nach § 9 Abs. 1 Nr. 3 Buchst. b StromStG wurde/wird eine Förderung nach § 34 EEG 2014 bzw. nach § 20 EEG 2017 (Marktprämie) gewährt.",
    "ke_n1": "Für die steuerfreien Strommengen nach § 9 Abs. 1 Nr. 3 Buchst. b StromStG wurde/wird eine Förderung nach § 34 EEG 2014 bzw. nach § 20 EEG 2017 (Marktprämie) gewährt.",
    "menge22": "Die Marktprämie wurde/wird gewährt für eine steuerfreie Strommenge von",
    "menge23": "Die Höhe der Marktprämie beläuft sich dabei auf",
    "ke_j2": "Die Höhe der Marktprämie wurde/wird um den der Stromsteuerbefreiung entsprechenden Teil verringert",
    "ke_n2": "Die Höhe der Marktprämie wurde/wird um den der Stromsteuerbefreiung entsprechenden Teil verringert"
  };

  function scanFields(ctx) {
    scanCount++;
    var newCount = 0;
    var els = document.querySelectorAll(FIELD_SELECTOR);
    for (var i = 0; i < els.length; i++) {
      try {
        var el = els[i];
        var id = el.id || el.name || null;
        if (!id || id.indexOf("lip") === 0 || id.indexOf("$") === 0) continue;
        // FIX v39 #2: Wenn ein Feld bereits erfasst wurde, aber mit
        // width=0/height=0 (hidden), und jetzt sichtbar ist: Koordinaten
        // und visible-Flag aktualisieren statt zu ueberspringen.
        if (allFields.has(id)) {
          var rect = el.getBoundingClientRect();
          var cs2 = window.getComputedStyle(el);
          var nowVis = rect.width > 0 && rect.height > 0 && cs2.display !== "none" && cs2.visibility !== "hidden";
          if (nowVis) {
            var ex = allFields.get(id);
            if (!ex.visible) {
              ex.visible = true;
              ex.position_x = Math.round(rect.left + window.scrollX);
              ex.position_y = Math.round(rect.top + window.scrollY);
              ex.width = Math.round(rect.width);
              ex.height = Math.round(rect.height);
              ex.foundInContext = ctx + ":updated";
              allFields.set(id, ex);
              log("  [updated] " + id + " jetzt sichtbar");
            }
          }
          continue;
        }
        var rect = el.getBoundingClientRect();
        var ft = el.tagName.toLowerCase();
        if (el.type) ft = el.type;
        if (el.getAttribute("role")) ft = el.getAttribute("role");
        var cs = window.getComputedStyle(el);
        var vis = rect.width > 0 && rect.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
        var istWichtig = false;
        for (var p = 0; p < IMPORTANT_HIDDEN_PATTERNS.length; p++) {
          if (id.indexOf(IMPORTANT_HIDDEN_PATTERNS[p]) >= 0) { istWichtig = true; break; }
        }
        if (!vis && !istWichtig) continue;
        var label = "";
        try {
          if (LABEL_MAP[id]) label = LABEL_MAP[id];
          else if (el.getAttribute("aria-label")) label = el.getAttribute("aria-label");
          else {
            var safeId = id.replace(/([.#\[\](){}:>+~=|^$*!@%&])/g, "\\$1");
            var lbl = document.querySelector("label[for='" + safeId + "']");
            if (lbl) label = lbl.textContent.trim();
          }
          if (!label) { var par = el.closest("label"); if (par) label = par.textContent.trim(); }
          if (!label && el.title) label = el.title;
          if (!label && el.placeholder) label = el.placeholder;
          if (!label) { var prev = el.previousElementSibling; if (prev && (prev.tagName === "LABEL" || prev.tagName === "SPAN" || prev.tagName === "DIV")) label = prev.textContent.trim().substring(0, 250); }
          if (!label) { var pa = el.parentElement; if (pa) { var ns = pa.childNodes; for (var n = 0; n < ns.length; n++) { if (ns[n].nodeType === 3 && ns[n].textContent.trim()) { label = ns[n].textContent.trim(); break; } } } }
        } catch (e) { }
        allFields.set(id, {
          id: id, name: el.name || "", fieldType: ft, tagName: el.tagName.toLowerCase(),
          label: (label || "").substring(0, 300),
          position_x: Math.round(rect.left + window.scrollX), position_y: Math.round(rect.top + window.scrollY),
          width: Math.round(rect.width), height: Math.round(rect.height),
          visible: vis,
          required: el.required || el.getAttribute("aria-required") === "true",
          disabled: el.disabled || false,
          options: el.tagName === "SELECT" ? Array.from(el.options).map(function (o) { return o.value + "=" + o.text; }).join(" | ") : "",
          foundInContext: ctx, foundInScan: scanCount
        });
        newCount++;
        if (!vis) log("  [hidden] " + id);
      } catch (e) { }
    }
    if (newCount > 0) log("  +" + newCount + " (" + ctx + ") | Gesamt: " + allFields.size);
    return newCount;
  }

  function fireSelectEvents(sel) {
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  // Robuster Klick: vollstaendige Event-Kette wie ein echter User-Klick
  // FMS/ffw.js reagiert auf change-Events, nicht nur auf click
  function simulateClick(el) {
    var rect = el.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.click();
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    if (el.type === "radio" || el.type === "checkbox") {
      if (!el.checked) el.checked = true;
    }
  }

  // Hilfsfunktion: Feld per ID klicken + scannen
  async function klickeUndScanne(id, beschreibung) {
    if (isTimedOut()) return 0;
    var el = document.getElementById(id);
    if (!el) return 0;
    var cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || el.disabled) return 0;
    var vorher = allFields.size;
    simulateClick(el); actionsLog.push(beschreibung || id);
    await waitForStable(); scanFields(beschreibung || id);
    var neu = allFields.size - vorher;
    if (neu > 0) log("  -> " + neu + " neue Felder nach: " + beschreibung);
    return neu;
  }

  // Hilfsfunktion: Radio per Name suchen und klicken
  async function sucheRadioUndKlicke(namePattern, jaOderNein, beschreibung) {
    if (isTimedOut()) return 0;
    var all = document.querySelectorAll("input[type=radio]");
    for (var i = 0; i < all.length; i++) {
      var r = all[i];
      if (!((r.name && r.name.indexOf(namePattern) >= 0) || (r.id && r.id.indexOf(namePattern) >= 0))) continue;
      var istJa = r.value === "ja" || r.id.indexOf("_ja") >= 0;
      var istNein = r.value === "nein" || r.id.indexOf("_nein") >= 0;
      if ((jaOderNein === "ja" && istJa) || (jaOderNein === "nein" && istNein)) {
        var cs = window.getComputedStyle(r);
        var vorher = allFields.size;
        simulateClick(r); actionsLog.push(beschreibung);
        await waitForStable(); scanFields(beschreibung);
        return allFields.size - vorher;
      }
    }
    return 0;
  }

  // ================================================
  // Einzelnes Dropdown komplett durchschalten
  // und nach jeder Option sofort neue Radios clicken
  // ================================================
  async function sweepDropdown(selId, label) {
    if (isTimedOut()) return;
    var sel = document.getElementById(selId);
    if (!sel) return;
    var cs = window.getComputedStyle(sel);
    if (cs.display === "none" || cs.visibility === "hidden" || sel.disabled) return;
    var origIdx = sel.selectedIndex;
    log("  Dropdown " + selId + " (" + sel.options.length + " Optionen)...");
    for (var oi = 0; oi < sel.options.length; oi++) {
      if (isTimedOut()) break;
      var optVal = sel.options[oi].value;
      if (!optVal || optVal === "") continue;
      if (oi === origIdx) continue;
      var vorher = allFields.size;
      try {
        sel.selectedIndex = oi;
        fireSelectEvents(sel);
        actionsLog.push(label + ":Sel:" + selId + "=" + optVal);
        await waitForStable();
        scanFields(label + ":Sel:" + selId + "=" + optVal);
        // Nach jeder Option: neue sichtbare Radios sofort anklicken
        var neueRadios = document.querySelectorAll("input[type=radio]");
        for (var nr = 0; nr < neueRadios.length; nr++) {
          var r = neueRadios[nr];
          if (r.name === "antragsteller") continue;
          var rRect = r.getBoundingClientRect();
          var rCs = window.getComputedStyle(r);
          if (rRect.width > 0 && rRect.height > 0 && rCs.display !== "none" && !r.checked && !r.disabled) {
            var rKey = label + ":Sel:" + selId + ":R:" + r.id;
            if (actionsLog.indexOf(rKey) === -1) {
              var v2 = allFields.size;
              simulateClick(r); actionsLog.push(rKey);
              await waitForStable();
              await wait(1500); // Extra Wartezeit fuer Felder die ganz unten erscheinen
              scanFields(rKey);
              // NACH dem Klick: nochmal ALLE Radios im DOM neu abfragen
              // damit neu erschienene Felder (z.B. eintrag ganz unten) gefunden werden
              neueRadios = document.querySelectorAll("input[type=radio]");
              if (allFields.size > v2) log("    >> Nested Radio " + r.id + " -> +" + (allFields.size - v2) + " neu");

              // SPEZIALFALL: eintrag-Nein wurde geklickt -> sofort wieder Ja klicken
              // damit reg_art2/reg_nr2/reg_gericht2 erscheinen und gesichert werden
              if (r.name === "eintrag" && r.id && r.id.indexOf("_nein") >= 0) {
                log("    >> eintrag-Nein geklickt, klicke sofort Ja fuer reg_art2/reg_nr2...");
                var jaRad = document.querySelector("input[type=radio][name='eintrag'][id*='_ja']");
                if (jaRad) {
                  simulateClick(jaRad);
                  await waitForStable();
                  await wait(2000); // Warten auf AJAX-Rendering
                  scanFields(rKey + ":JaReset");
                  // Alle Ziel-IDs direkt per getElementById sichern
                  var regZiele = ["Vorblatt_reg_art2", "Vorblatt_reg_art2-selectized",
                    "Vorblatt_reg_nr2", "Vorblatt_reg_gericht2"];
                  for (var rz = 0; rz < regZiele.length; rz++) {
                    var rzid = regZiele[rz];
                    if (allFields.has(rzid)) continue;
                    var rzel = document.getElementById(rzid);
                    if (!rzel) { log("    NICHT IM DOM: " + rzid); continue; }
                    var rzRect = rzel.getBoundingClientRect();
                    var rzCs = window.getComputedStyle(rzel);
                    var rzVis = rzRect.width > 0 && rzRect.height > 0 && rzCs.display !== "none";
                    var rzFt = rzel.tagName.toLowerCase();
                    if (rzel.type) rzFt = rzel.type;
                    if (rzel.getAttribute("role")) rzFt = rzel.getAttribute("role");
                    var rzLbl = LABEL_MAP[rzid] || rzel.getAttribute("aria-label") || rzel.title || "";
                    try {
                      var rzL2 = document.querySelector("label[for='" + rzid.replace(/([.#\[\](){}:>+~=|^$*!@%&])/g, "\\$1") + "']");
                      if (rzL2) rzLbl = rzL2.textContent.trim();
                    } catch (e3) { }
                    allFields.set(rzid, {
                      id: rzid, name: rzel.name || "", fieldType: rzFt, tagName: rzel.tagName.toLowerCase(),
                      label: rzLbl.substring(0, 300),
                      position_x: Math.round(rzRect.left + window.scrollX), position_y: Math.round(rzRect.top + window.scrollY),
                      width: Math.round(rzRect.width), height: Math.round(rzRect.height),
                      visible: rzVis, required: rzel.required || false, disabled: rzel.disabled || false,
                      options: rzel.tagName === "SELECT" ? Array.from(rzel.options).map(function (o) { return o.value + "=" + o.text; }).join(" | ") : "",
                      foundInContext: rKey + ":eintragJa", foundInScan: scanCount
                    });
                    log("    Gesichert: " + rzid + " (vis:" + rzVis + ")");
                  }
                }
              }

              // KRITISCH: Nach dem Radio-Klick sofort alle sichtbaren
              // Felder und nested Dropdowns sichern -- BEVOR der Select
              // zurückgesetzt wird und das Formular wieder zuklappt!
              var nestedSels = document.querySelectorAll("select");
              for (var ns = 0; ns < nestedSels.length; ns++) {
                var nsel = nestedSels[ns];
                var nsId = nsel.id || nsel.name;
                if (!nsId || nsId.indexOf("lip") === 0 || nsId.indexOf("$") === 0) continue;
                if (allFields.has(nsId)) continue;
                var nsRect = nsel.getBoundingClientRect();
                var nsCs = window.getComputedStyle(nsel);
                if (nsRect.width > 0 && nsRect.height > 0 && nsCs.display !== "none" && !nsel.disabled) {
                  var v3 = allFields.size;
                  // Jede Option dieses nested Dropdowns durchschalten
                  var nsOrig = nsel.selectedIndex;
                  for (var no = 0; no < nsel.options.length; no++) {
                    if (isTimedOut()) break;
                    var noVal = nsel.options[no].value;
                    if (!noVal || noVal === "") continue;
                    if (no === nsOrig) continue;
                    nsel.selectedIndex = no;
                    fireSelectEvents(nsel);
                    await waitForStable();
                    scanFields(rKey + ":Sel:" + nsId + "=" + noVal);
                  }
                  try { nsel.selectedIndex = nsOrig; fireSelectEvents(nsel); await wait(200); } catch (e2) { }
                  if (allFields.size > v3) log("    >> Nested Dropdown " + nsId + " -> +" + (allFields.size - v3) + " neu");
                }
              }

              // Alle aktuell sichtbaren Felder sofort als "gesehen" markieren
              // (auch wenn sie beim nächsten Select-Wechsel wieder hidden werden)
              var alleFelder = document.querySelectorAll(FIELD_SELECTOR);
              for (var af = 0; af < alleFelder.length; af++) {
                var afe = alleFelder[af];
                var afId = afe.id || afe.name || null;
                if (!afId || afId.indexOf("lip") === 0 || afId.indexOf("$") === 0) continue;
                if (allFields.has(afId)) continue;
                var afRect = afe.getBoundingClientRect();
                var afCs = window.getComputedStyle(afe);
                var afVis = afRect.width > 0 && afRect.height > 0 && afCs.display !== "none" && afCs.visibility !== "hidden";
                if (!afVis) continue;
                var afFt = afe.tagName.toLowerCase();
                if (afe.type) afFt = afe.type;
                if (afe.getAttribute("role")) afFt = afe.getAttribute("role");
                var afLabel = LABEL_MAP[afId] || afe.getAttribute("aria-label") || afe.title || afe.placeholder || "";
                allFields.set(afId, {
                  id: afId, name: afe.name || "", fieldType: afFt, tagName: afe.tagName.toLowerCase(),
                  label: afLabel.substring(0, 300),
                  position_x: Math.round(afRect.left + window.scrollX), position_y: Math.round(afRect.top + window.scrollY),
                  width: Math.round(afRect.width), height: Math.round(afRect.height),
                  visible: true,
                  required: afe.required || afe.getAttribute("aria-required") === "true",
                  disabled: afe.disabled || false,
                  options: afe.tagName === "SELECT" ? Array.from(afe.options).map(function (o) { return o.value + "=" + o.text; }).join(" | ") : "",
                  foundInContext: rKey + ":sofort", foundInScan: scanCount
                });
              }
              if (allFields.size > v2) log("    >> Nach Sofort-Scan: +" + (allFields.size - v2) + " gesichert");
            }
          }
        }
      } catch (e) { }
      if (allFields.size > vorher) log("  >> " + selId + "='" + optVal + "' -> +" + (allFields.size - vorher) + " neu");
    }
    // FIX v39 #3: Register-Felder SOFORT sichern bevor selectedIndex
    // zurueckgesetzt wird und das Formular zuklappt. Im Original geschah
    // sucheRegisterFelder() erst nach diesem Reset — dann waren die
    // Felder bereits aus dem DOM verschwunden.
    sucheRegisterFelder(
      ["Vorblatt_reg_art2", "Vorblatt_reg_art2-selectized",
       "Vorblatt_reg_nr2", "Vorblatt_reg_gericht2",
       "Vorblatt_k_regeintrag_ja", "Vorblatt_k_regeintrag_nein",
       "Vorblatt_reg_art3", "Vorblatt_reg_nr3", "Vorblatt_reg_gericht3",
       "Vorblatt_reg_art3-selectized",
       "Vorblatt_k_regeintrag_vertr_ja", "Vorblatt_k_regeintrag_vertr_nein"],
      selId + ":vorReset"
    );
    try { sel.selectedIndex = origIdx; fireSelectEvents(sel); await wait(400); } catch (e) { }
  }

  // ================================================
  // Kompletter Sweep: Radios + CBs + kleine Dropdowns
  // ================================================
  async function sweepAlles(label) {
    var sweepNr = 0;
    var maxSweeps = 8;
    var totalNeu = 0;
    while (sweepNr < maxSweeps && !isTimedOut()) {
      sweepNr++;
      var neuInSweep = 0;

      // Radios -- von UNTEN nach OBEN sortiert
      // Damit erscheinen neue Felder ganz unten (z.B. eintrag-Radio)
      // zuerst und werden angeklickt bevor etwas drueber zugeklappt wird
      var radios = document.querySelectorAll("input[type=radio]");
      var radioList = [];
      for (var i = 0; i < radios.length; i++) {
        var r = radios[i];
        if (r.name === "antragsteller") continue;
        var rc = r.getBoundingClientRect();
        var cs = window.getComputedStyle(r);
        if (rc.width > 0 && rc.height > 0 && cs.display !== "none" && cs.visibility !== "hidden" && !r.disabled && !r.checked) {
          radioList.push({ el: r, id: r.id || r.name, y: Math.round(rc.top + window.scrollY), x: Math.round(rc.left + window.scrollX) });
        }
      }
      // VON UNTEN NACH OBEN sortieren
      radioList.sort(function (a, b) { if (Math.abs(a.y - b.y) < 10) return b.x - a.x; return b.y - a.y; });
      var radioIdx = 0;
      while (radioIdx < radioList.length && !isTimedOut()) {
        var tg = radioList[radioIdx];
        radioIdx++;
        var rc2 = tg.el.getBoundingClientRect();
        if (rc2.width <= 0 || rc2.height <= 0) continue;
        var cs2 = window.getComputedStyle(tg.el);
        if (cs2.display === "none" || cs2.visibility === "hidden" || tg.el.checked) continue;
        var vorher = allFields.size;
        try {
          simulateClick(tg.el); actionsLog.push(label + ":R:" + tg.id);
          await waitForStable();
          await wait(1200); // FIX v39 #5: 800→1200ms, AJAX-Ketten brauchen mehr Zeit
          scanFields(label + ":R:" + tg.id);
        } catch (e) { }
        if (allFields.size > vorher) {
          log("  >> " + tg.id + " -> +" + (allFields.size - vorher) + " neu");
          neuInSweep += (allFields.size - vorher);
          // Neu erschienene Radios sofort in die Liste einfuegen (auch ganz unten)
          var neueR = document.querySelectorAll("input[type=radio]");
          for (var nr2 = 0; nr2 < neueR.length; nr2++) {
            var nr2el = neueR[nr2];
            if (nr2el.name === "antragsteller") continue;
            var nr2rect = nr2el.getBoundingClientRect();
            var nr2cs = window.getComputedStyle(nr2el);
            if (nr2rect.width > 0 && nr2rect.height > 0 && nr2cs.display !== "none" && !nr2el.disabled && !nr2el.checked) {
              var nr2id = nr2el.id || nr2el.name;
              var nr2key = label + ":R:" + nr2id;
              // Pruefen ob noch nicht in radioList und noch nicht in actionsLog
              var bereitsInListe = false;
              for (var rl = 0; rl < radioList.length; rl++) { if (radioList[rl].id === nr2id) { bereitsInListe = true; break; } }
              if (!bereitsInListe && actionsLog.indexOf(nr2key) === -1) {
                var nr2y = Math.round(nr2rect.top + window.scrollY);
                // Vor dem aktuellen Index einfuegen (hoeheres y = weiter unten = frueher dran)
                radioList.splice(radioIdx, 0, { el: nr2el, id: nr2id, y: nr2y, x: Math.round(nr2rect.left + window.scrollX) });
                log("  ++ Neuen Radio eingefuegt: " + nr2id + " y=" + nr2y);
              }
            }
          }
        }
      }

      // Checkboxen
      var cbs = document.querySelectorAll("input[type=checkbox]");
      var cbList = [];
      for (var i = 0; i < cbs.length; i++) {
        var c = cbs[i];
        var rc = c.getBoundingClientRect();
        var cs = window.getComputedStyle(c);
        if (rc.width > 0 && rc.height > 0 && cs.display !== "none" && cs.visibility !== "hidden" && !c.disabled && !c.checked) {
          cbList.push({ el: c, id: c.id || c.name, y: Math.round(rc.top + window.scrollY), x: Math.round(rc.left + window.scrollX) });
        }
      }
      cbList.sort(function (a, b) { if (Math.abs(a.y - b.y) < 10) return a.x - b.x; return a.y - b.y; });
      for (var t = 0; t < cbList.length; t++) {
        if (isTimedOut()) break;
        var tg = cbList[t];
        var rc2 = tg.el.getBoundingClientRect();
        if (rc2.width <= 0 || rc2.height <= 0) continue;
        var cs2 = window.getComputedStyle(tg.el);
        if (cs2.display === "none" || cs2.visibility === "hidden" || tg.el.checked) continue;
        var vorher = allFields.size;
        try { simulateClick(tg.el); actionsLog.push(label + ":CB:" + tg.id); await waitForStable(); scanFields(label + ":CB:" + tg.id); } catch (e) { }
        if (allFields.size > vorher) { log("  >> " + tg.id + " -> +" + (allFields.size - vorher) + " neu"); neuInSweep += (allFields.size - vorher); }
      }

      // Dropdowns (max 30 Optionen)
      var sels = document.querySelectorAll("select");
      var selList = [];
      for (var i = 0; i < sels.length; i++) {
        var s = sels[i];
        var sid = s.id || s.name;
        if (!sid || sid.indexOf("lip") === 0 || sid.indexOf("$") === 0) continue;
        var rc = s.getBoundingClientRect();
        var cs = window.getComputedStyle(s);
        if (rc.width > 0 && rc.height > 0 && cs.display !== "none" && cs.visibility !== "hidden" && !s.disabled && s.options.length <= 30) {
          selList.push({ el: s, id: sid, y: Math.round(rc.top + window.scrollY) });
        }
      }
      selList.sort(function (a, b) { return a.y - b.y; });
      for (var s = 0; s < selList.length; s++) {
        if (isTimedOut()) break;
        var sel = selList[s];
        var origIdx = sel.el.selectedIndex;
        for (var oi = 0; oi < sel.el.options.length; oi++) {
          if (isTimedOut()) break;
          if (oi === origIdx) continue;
          var vorher = allFields.size;
          try { sel.el.selectedIndex = oi; fireSelectEvents(sel.el); actionsLog.push(label + ":Sel:" + sel.id + "=" + sel.el.options[oi].value); await waitForStable(); await wait(300); scanFields(label + ":Sel:" + sel.id + "=" + sel.el.options[oi].text); } catch (e) { }
          if (allFields.size > vorher) { log("  >> " + sel.id + "='" + sel.el.options[oi].text + "' -> +" + (allFields.size - vorher) + " neu"); neuInSweep += (allFields.size - vorher); }
        }
        try { sel.el.selectedIndex = origIdx; fireSelectEvents(sel.el); await wait(300); } catch (e) { }
      }

      totalNeu += neuInSweep;
      log("  Sweep " + sweepNr + ": +" + neuInSweep + " neue Felder");
      if (neuInSweep === 0) break;
      log("  -> Neue Felder, starte Sweep nochmal von oben...");
    }
    return totalNeu;
  }

  // ================================================
  // Register-Felder gezielt per ID in DOM suchen
  // ================================================
  function sucheRegisterFelder(liste, kontext) {
    for (var rf = 0; rf < liste.length; rf++) {
      var el = document.getElementById(liste[rf]);
      if (el && !allFields.has(liste[rf])) {
        log("  Register-Feld gefunden (evtl hidden): " + liste[rf]);
        var rect = el.getBoundingClientRect();
        allFields.set(liste[rf], {
          id: liste[rf], name: el.name || "", fieldType: el.type || el.tagName.toLowerCase(),
          tagName: el.tagName.toLowerCase(), label: LABEL_MAP[liste[rf]] || el.getAttribute("aria-label") || el.title || "",
          position_x: Math.round(rect.left + window.scrollX), position_y: Math.round(rect.top + window.scrollY),
          width: Math.round(rect.width), height: Math.round(rect.height),
          visible: rect.width > 0 && rect.height > 0, required: false, disabled: false, options: "",
          foundInContext: kontext, foundInScan: scanCount
        });
      }
    }
    // Auch alle select[id*=reg_] erfassen
    var regSelects = document.querySelectorAll("select");
    for (var rs = 0; rs < regSelects.length; rs++) {
      var rsel = regSelects[rs];
      var rsId = rsel.id || rsel.name;
      if (rsId && rsId.indexOf("reg_") >= 0 && !allFields.has(rsId)) {
        var rsRect = rsel.getBoundingClientRect();
        allFields.set(rsId, {
          id: rsId, name: rsel.name || "", fieldType: "select-one", tagName: "select",
          label: LABEL_MAP[rsId] || rsel.getAttribute("aria-label") || "",
          position_x: Math.round(rsRect.left + window.scrollX), position_y: Math.round(rsRect.top + window.scrollY),
          width: Math.round(rsRect.width), height: Math.round(rsRect.height),
          visible: rsRect.width > 0 && rsRect.height > 0, required: false, disabled: false,
          options: Array.from(rsel.options).map(function (o) { return o.value + "=" + o.text; }).join(" | "),
          foundInContext: kontext + "-Select", foundInScan: scanCount
        });
        log("  Register-Select gefunden: " + rsId);
      }
    }
  }

  // ================================================
  // ZUSTAND SPEICHERN
  // ================================================
  var savedRadios = [];
  var rr = document.querySelectorAll("input[type=radio]");
  for (var i = 0; i < rr.length; i++) { if (rr[i].checked) savedRadios.push({ id: rr[i].id, name: rr[i].name, value: rr[i].value }); }
  var savedCheckboxes = [];
  var cc = document.querySelectorAll("input[type=checkbox]");
  for (var i = 0; i < cc.length; i++) { savedCheckboxes.push({ id: cc[i].id, name: cc[i].name, checked: cc[i].checked }); }
  var savedSelects = [];
  var ss = document.querySelectorAll("select");
  for (var i = 0; i < ss.length; i++) { savedSelects.push({ id: ss[i].id, selectedIndex: ss[i].selectedIndex }); }

  var antrag1 = document.getElementById("Vorblatt_k_antrag1");
  var antrag2 = document.getElementById("Vorblatt_k_antrag2");
  var istVorblatt = !!(antrag1 || antrag2);

  log("============================================");
  log("FORMULAR 1400 - SCAN v39 (Multi-Page)");
  log("waitForStable +300ms Puffer (Fix #1)");
  log("scanFields aktualisiert hidden→visible (Fix #2)");
  log("============================================");

  // ================================================
  // SCHRITT 1: Sichtbare Felder
  // ================================================
  log("Schritt 1: Sichtbare Felder...");
  scanFields("Sichtbar");

  if (istVorblatt) {

    // ================================================
    // SCHRITT 2: Antrag in eigenem Namen aktivieren
    // Wir erzwingen "eigenem Namen" damit ALLE Pfade
    // erreichbar sind — unabhängig vom Startzustand
    // ================================================
    log("Schritt 2: Antrag in eigenem Namen aktivieren...");
    if (antrag1 && !antrag1.checked) {
      simulateClick(antrag1);
      await waitForStable();
      scanFields("EigenemNamen");
    }

    // ================================================
    // SCHRITT 3: Rechtsform-Dropdowns ZUERST
    // Bevor irgendein anderer Pfad läuft!
    // Dadurch werden rechtsformabhängige Felder
    // (Registereintrag etc.) korrekt erkannt
    // ================================================
    log("Schritt 3: Rechtsform-Dropdowns (Antragsteller + Bevollmächtigter)...");
    await sweepDropdown("Vorblatt_rechtsform", "VB");
    await sweepDropdown("Vorblatt_rechtsform2", "VB2");

    // ================================================
    // SCHRITT 4: Registereintrag Antragsteller
    // ================================================
    log("Schritt 4: Registereintrag Antragsteller...");
    await sucheRadioUndKlicke("registereintrag", "ja", "Register Ja");
    // FIX v39 #4: "register" als Substring matched auch "regeintrag" und
    // andere Radio-Namen. Exakter Pattern "_k_register" verhindert, dass
    // das falsche Radio geklickt wird und den Formular-Zustand korrumpiert.
    await sucheRadioUndKlicke("_k_register", "ja", "Register Ja (alt)");
    await wait(2000); await waitForStable(); scanFields("NachRegister");
    sucheRegisterFelder(["Vorblatt_reg_art", "Vorblatt_reg_nr", "Vorblatt_reg_gericht"], "Register-Antragsteller");

    // ================================================
    // SCHRITT 5: Postfach
    // ================================================
    if (!isTimedOut()) {
      log("Schritt 5: Postfach...");
      await klickeUndScanne("Vorblatt_k_postfach_ja", "Postfach Ja");
      await klickeUndScanne("Vorblatt_k_post_aenderung_ja", "Postfach Aend Ja");
    }

    // ================================================
    // SCHRITT 6: Sitz der Geschäftsleitung
    // ================================================
    if (!isTimedOut()) {
      log("Schritt 6: Sitz der Geschaeftsleitung...");
      await klickeUndScanne("Vorblatt_k_Sitz_geschaeft_ja", "Sitz Ja");
      await klickeUndScanne("Vorblatt_k_geschaeft_aenderung_ja", "Sitz Aend Ja");
    }

    // ================================================
    // SCHRITT 7: Hauptbuchhaltung
    // ================================================
    if (!isTimedOut()) {
      log("Schritt 7: Hauptbuchhaltung...");
      await klickeUndScanne("Vorblatt_k_Hauptbuchhaltung_ja", "Buchh Ja");
      await klickeUndScanne("Vorblatt_k_hauptbuchhaltung_ort_ja", "BuchhOrt Ja");
      await sucheRadioUndKlicke("hauptbuchhaltung_aenderung", "ja", "BuchhAend Ja");
    }

    // ================================================
    // SCHRITT 8: Empfangsvollmacht
    // IMMER durchlaufen (nicht abhängig von istEigenem!)
    // Vollständige Kette:
    //   Empfang=Ja → Änderungen=Ja → Vollumfänglich=Ja
    //   → Daten Bevollmächtigter sichtbar
    //   → Rechtsform Bevollmächtigter → Registereintrag=Ja
    //   → Registerart, Registernummer, Registergericht
    // ================================================
    if (!isTimedOut()) {
      log("Schritt 8: Empfangsvollmacht (vollständige Kette)...");

      await klickeUndScanne("Vorblatt_k_empfang_ja", "Empfang Ja");
      await klickeUndScanne("Vorblatt_k_antragstellung_ja", "Antragst Ja");

      // Beide Varianten von Vollumfänglich durchlaufen
      log("  8a: Vollumfaenglich Ja...");
      await klickeUndScanne("Vorblatt_k_rechtsbereich_ja", "Rechtsber Ja");

      log("  8b: Vollumfaenglich Nein (Einzel-Bereiche)...");
      await klickeUndScanne("Vorblatt_k_rechtsbereich_nein", "Rechtsber Nein");
      // Alle Bereichs-Checkboxen anklicken
      for (var b = 1; b <= 8; b++) {
        await klickeUndScanne("Vorblatt_bereich2_" + b, "Bereich2_" + b);
      }

      // -----------------------------------------------
      // 8c: RF2=AdöR setzen, eintrag-Radio direkt klicken
      // Das Feld erscheint GANZ UNTEN nach RF2=AdöR --
      // sweepDropdown wuerde es nicht finden da es RF2
      // nach jeder Option zuruecksetzt (Feld verschwindet)
      // -----------------------------------------------
      log("  8c: RF2=AdoeR → eintrag-Radio direkt klicken...");
      var rf2 = document.getElementById("Vorblatt_rechtsform2");
      if (rf2) {
        var adoerIdx = -1;
        for (var oi2 = 0; oi2 < rf2.options.length; oi2++) {
          if (rf2.options[oi2].value === "AdöR") { adoerIdx = oi2; break; }
        }
        if (adoerIdx >= 0) {
          var rf2Orig = rf2.selectedIndex;
          // RF2=AdöR setzen und warten
          rf2.selectedIndex = adoerIdx;
          fireSelectEvents(rf2);
          await waitForStable();
          await wait(3000); // Warten bis eintrag-Radio ganz unten erscheint
          scanFields("8c:RF2=AdöR");

          // eintrag-Radio suchen
          var jaEl = document.querySelector("input[type=radio][name='eintrag'][id*='_ja']");
          var neinEl = document.querySelector("input[type=radio][name='eintrag'][id*='_nein']");
          log("  eintrag: ja=" + (jaEl ? jaEl.id : "NICHT DA") + " nein=" + (neinEl ? neinEl.id : "NICHT DA"));

          if (jaEl) {
            // Ja ist evtl schon checked → Nein klicken (Reset), dann Ja
            if (jaEl.checked && neinEl) {
              simulateClick(neinEl); await waitForStable(); await wait(500);
            }
            simulateClick(jaEl);
            actionsLog.push("8c:eintrag-ja");
            await waitForStable();
            await wait(3000); // Warten auf AJAX reg_art2 etc.
            scanFields("8c:NachEintragJa");

            // DEBUG: alle Elemente die "reg" im ID haben nach dem Klick
            log("  --- DOM-Dump reg-Felder nach eintrag-Ja ---");
            document.querySelectorAll("input,select,textarea,div[id*='reg']").forEach(function (el) {
              if (el.id && el.id.toLowerCase().indexOf("reg_art2") >= 0 ||
                el.id && el.id.toLowerCase().indexOf("reg_nr2") >= 0 ||
                el.id && el.id.toLowerCase().indexOf("reg_gericht2") >= 0) {
                var r = el.getBoundingClientRect();
                log("    GEFUNDEN: id=" + el.id + " tag=" + el.tagName + " display=" + window.getComputedStyle(el).display + " w=" + Math.round(r.width) + " h=" + Math.round(r.height) + " y=" + Math.round(r.top + window.scrollY));
              }
            });

            // reg-Felder sofort per getElementById sichern
            var regZiele = ["Vorblatt_reg_art2", "Vorblatt_reg_art2-selectized",
              "Vorblatt_reg_nr2", "Vorblatt_reg_gericht2",
              "Vorblatt_k_regeintrag_ja", "Vorblatt_k_regeintrag_nein"];
            for (var rz = 0; rz < regZiele.length; rz++) {
              var rzid = regZiele[rz];
              if (allFields.has(rzid)) continue;
              var rzel = document.getElementById(rzid);
              if (!rzel) { log("  NICHT IM DOM: " + rzid); continue; }
              var rRect = rzel.getBoundingClientRect();
              var rVis = rRect.width > 0 && rRect.height > 0 && window.getComputedStyle(rzel).display !== "none";
              var rFt = rzel.tagName.toLowerCase();
              if (rzel.type) rFt = rzel.type;
              if (rzel.getAttribute("role")) rFt = rzel.getAttribute("role");
              var rLbl = ""; try { var lx = document.querySelector("label[for='" + rzid.replace(/([.#\[\](){}:>+~=|^$*!@%&])/g, "\\$1") + "']"); if (lx) rLbl = lx.textContent.trim(); if (!rLbl) rLbl = rzel.getAttribute("aria-label") || rzel.title || ""; } catch (ex) { }
              allFields.set(rzid, { id: rzid, name: rzel.name || "", fieldType: rFt, tagName: rzel.tagName.toLowerCase(), label: rLbl.substring(0, 300), position_x: Math.round(rRect.left + window.scrollX), position_y: Math.round(rRect.top + window.scrollY), width: Math.round(rRect.width), height: Math.round(rRect.height), visible: rVis, required: rzel.required || false, disabled: rzel.disabled || false, options: rzel.tagName === "SELECT" ? Array.from(rzel.options).map(function (o) { return o.value + "=" + o.text; }).join(" | ") : "", foundInContext: "8c-direkt", foundInScan: scanCount });
              log("  ✅ " + rzid + " vis=" + rVis);
            }
          } else {
            log("  !! eintrag-Ja NICHT gefunden nach RF2=AdöR + 3s Warten");
          }

          // RF2 zuruecksetzen
          rf2.selectedIndex = rf2Orig;
          fireSelectEvents(rf2);
          await wait(400);
        }
      }
      sucheRegisterFelder(["Vorblatt_k_regeintrag_ja", "Vorblatt_k_regeintrag_nein", "Vorblatt_reg_art2", "Vorblatt_reg_nr2", "Vorblatt_reg_gericht2", "Vorblatt_reg_art3", "Vorblatt_reg_nr3", "Vorblatt_reg_gericht3"], "Regeintrag-Fallback");
    }

    // ================================================
    // SCHRITT 9: Antrag in fremdem Namen
    // ================================================
    if (!isTimedOut()) {
      log("Schritt 9: Antrag in fremdem Namen...");
      if (antrag2) {
        simulateClick(antrag2);
        await waitForStable(); scanFields("FremdemNamen");
        // 9a: Registereintrag des Vertretenen (name="registereintrag")
        await sucheRadioUndKlicke("registereintrag", "ja", "Register Vertreten Ja");
        await wait(1500); await waitForStable(); scanFields("NachRegisterVertreten");
        sucheRegisterFelder(["Vorblatt_reg_art", "Vorblatt_reg_nr", "Vorblatt_reg_gericht"], "Register-Vertreten");

        // 9b: Registereintrag des Empfangsbevollmaechtigten (name="regeintrag")
        await sucheRadioUndKlicke("regeintrag", "ja", "Regeintrag Vertr Ja");
        await wait(2000); await waitForStable(); scanFields("NachRegeintragVertr");
        sucheRegisterFelder(["Vorblatt_k_regeintrag_vertr_ja", "Vorblatt_k_regeintrag_vertr_nein",
          "Vorblatt_reg_art3", "Vorblatt_reg_nr3", "Vorblatt_reg_gericht3",
          "Vorblatt_reg_art3-selectized"], "Register-Empfangsbev");
      }
    }
  }

  // ================================================
  // Seite 1 Felder
  // ================================================
  var kj1 = document.getElementById("k_j1");
  if (kj1) {
    if (!isTimedOut()) await klickeUndScanne("k_j1", "3.1 Ja");
    if (!isTimedOut()) { await klickeUndScanne("k_n3", "5.2 Nein"); await klickeUndScanne("k_j4", "5.2.1 Ja"); }
    if (!isTimedOut()) { await klickeUndScanne("k11", "6.1 Ja"); await klickeUndScanne("k14", "6.1.2 Nein"); }
    if (!isTimedOut()) { await klickeUndScanne("k15", "6.2 Ja"); await klickeUndScanne("k17", "6.2.1 Ja"); }
    if (!isTimedOut()) await klickeUndScanne("k19", "6.3 Ja");
    if (!isTimedOut()) await klickeUndScanne("k21", "6.4 Ja");
    if (!isTimedOut()) { await klickeUndScanne("k23", "6.5 Ja"); await klickeUndScanne("k25", "6.5.1"); await klickeUndScanne("k27", "6.5.2"); await klickeUndScanne("k29", "6.5.3"); await klickeUndScanne("k31", "6.5.4"); }
    if (!isTimedOut()) await klickeUndScanne("k35", "8.1 Ja");
  }
  var kj2 = document.getElementById("k_j2");
  if (kj2 && !isTimedOut()) { await klickeUndScanne("k_j2", "3.2 Ja"); await klickeUndScanne("k33", "7.3 Ja"); }

  // ================================================
  // SCHRITT FINAL: Kompletter Sweep
  // ================================================
  if (!isTimedOut()) {
    log("Schritt Final: Kompletter Sweep...");
    var gefunden = await sweepAlles("Sweep");
    log("Sweep fertig: " + gefunden + " zusaetzliche Felder");
  }

  scanFields("FINAL");

  // ================================================
  // MULTI-PAGE: Seitenwechsel-Funktion
  // ================================================
  async function wechsleSeite(seitenId, label) {
    log(">>> Wechsle zu " + label + " <<<");
    var btn = null;
    var alle = document.querySelectorAll("input[type=image]");
    for (var i = 0; i < alle.length; i++) {
      var n = (alle[i].name || "") + (alle[i].title || "");
      if (n.indexOf(seitenId) >= 0) { btn = alle[i]; break; }
    }
    if (!btn) {
      log("  WARNUNG: Button fuer " + label + " nicht gefunden!");
      errors.push("Seitenbutton nicht gefunden: " + label);
      return false;
    }
    btn.click();
    await wait(3000);
    // Warte bis seitenspezifisches Element erscheint
    var maxW = 15000; var w = 0;
    while (w < maxW) {
      await wait(500); w += 500;
      if (seitenId === "Seite1" && document.getElementById("k_j1")) break;
      if (seitenId === "Seite2" && document.getElementById("ke_j1")) break;
    }
    await waitForStable();
    await wait(1000);
    log("  " + label + " geladen!");
    return true;
  }

  // ================================================
  // MULTI-PAGE: Wenn wir auf dem Vorblatt gestartet
  // haben, jetzt Seite 1 und Seite 2 scannen
  // ================================================
  if (istVorblatt && !isTimedOut()) {

    // ---- SEITE 1 ----
    var ok1 = await wechsleSeite("Seite1", "Seite 1");
    if (ok1 && !isTimedOut()) {
      log("=== SEITE 1: Starte Scan (gleicher Ablauf wie v32) ===");
      scanFields("S1:Sichtbar");

      // Exakt gleiche Klick-Reihenfolge wie oben fuer Seite 1
      var s1_kj1 = document.getElementById("k_j1");
      if (s1_kj1) {
        if (!isTimedOut()) await klickeUndScanne("k_j1", "3.1 Ja");
        if (!isTimedOut()) { await klickeUndScanne("k_n3", "5.2 Nein"); await klickeUndScanne("k_j4", "5.2.1 Ja"); }
        if (!isTimedOut()) { await klickeUndScanne("k11", "6.1 Ja"); await klickeUndScanne("k14", "6.1.2 Nein"); }
        if (!isTimedOut()) { await klickeUndScanne("k15", "6.2 Ja"); await klickeUndScanne("k17", "6.2.1 Ja"); }
        if (!isTimedOut()) await klickeUndScanne("k19", "6.3 Ja");
        if (!isTimedOut()) await klickeUndScanne("k21", "6.4 Ja");
        if (!isTimedOut()) { await klickeUndScanne("k23", "6.5 Ja"); await klickeUndScanne("k25", "6.5.1"); await klickeUndScanne("k27", "6.5.2"); await klickeUndScanne("k29", "6.5.3"); await klickeUndScanne("k31", "6.5.4"); }
        if (!isTimedOut()) await klickeUndScanne("k35", "8.1 Ja");
      }
      var s1_kj2 = document.getElementById("k_j2");
      if (s1_kj2 && !isTimedOut()) { await klickeUndScanne("k_j2", "3.2 Ja"); await klickeUndScanne("k33", "7.3 Ja"); }

      if (!isTimedOut()) {
        log("Seite 1: Sweep...");
        var s1gef = await sweepAlles("S1:Sweep");
        log("Seite 1 Sweep: " + s1gef + " zusaetzliche Felder");
      }
      scanFields("S1:FINAL");
      log("=== SEITE 1 FERTIG: " + allFields.size + " Felder gesamt ===");
    }

    // ---- SEITE 2 ----
    if (!isTimedOut()) {
      var ok2 = await wechsleSeite("Seite2", "Seite 2");
      if (ok2 && !isTimedOut()) {
        log("=== SEITE 2: Starte Scan ===");
        scanFields("S2:Sichtbar");
        // ke_j1 anklicken fuer Marktpraemie-Felder
        if (!isTimedOut()) await klickeUndScanne("ke_j1", "S2:Markt Ja");
        if (!isTimedOut()) {
          var s2gef = await sweepAlles("S2:Sweep");
          log("Seite 2 Sweep: " + s2gef + " zusaetzliche Felder");
        }
        scanFields("S2:FINAL");
        log("=== SEITE 2 FERTIG: " + allFields.size + " Felder gesamt ===");
      }
    }

    // Zurueck zum Vorblatt
    if (!isTimedOut()) {
      log("Wechsle zurueck zum Vorblatt...");
      var vbBtn = null;
      var alleBtn = document.querySelectorAll("input[type=image], img.button");
      for (var i = 0; i < alleBtn.length; i++) {
        var t = (alleBtn[i].title || "") + (alleBtn[i].alt || "") + (alleBtn[i].name || "");
        if (t.indexOf("Vorblatt") >= 0 || t.indexOf("orblat") >= 0) { vbBtn = alleBtn[i]; break; }
      }
      if (vbBtn) { vbBtn.click(); await wait(3000); await waitForStable(); log("Zurueck auf Vorblatt!"); }
    }
  }

  // ================================================
  // ZUSTAND WIEDERHERSTELLEN
  // ================================================
  log("Stelle Originalzustand wieder her...");
  try {
    // Antragsteller-Radio wiederherstellen
    var origAntrag = null;
    for (var i = 0; i < savedRadios.length; i++) { if (savedRadios[i].name === "antragsteller") { origAntrag = savedRadios[i]; break; } }
    if (origAntrag) {
      var el = document.getElementById(origAntrag.id);
      if (el && !el.checked) { el.click(); await wait(500); }
    } else if (antrag1) {
      // War ursprünglich keiner ausgewählt — alles zurücksetzen
      // (Browser erlaubt das nicht direkt, daher nichts tun)
    }

    // Übrige Radios
    for (var i = 0; i < savedRadios.length; i++) {
      var s = savedRadios[i]; if (s.name === "antragsteller") continue;
      var el = document.getElementById(s.id);
      if (!el && s.name) { var cn = document.querySelectorAll("input[name='" + s.name + "']"); for (var c = 0; c < cn.length; c++) { if (cn[c].value === s.value) { el = cn[c]; break; } } }
      if (el && !el.checked) { el.click(); await wait(300); }
    }
    // Checkboxen
    var allCb = document.querySelectorAll("input[type=checkbox]");
    for (var i = 0; i < allCb.length; i++) {
      var cb = allCb[i]; var orig = null;
      for (var j = 0; j < savedCheckboxes.length; j++) { if (savedCheckboxes[j].id === cb.id) { orig = savedCheckboxes[j]; break; } }
      if (orig && orig.checked !== cb.checked) { cb.click(); await wait(200); }
    }
    // Selects
    for (var i = 0; i < savedSelects.length; i++) {
      var s = savedSelects[i]; var el = document.getElementById(s.id);
      if (el && el.selectedIndex !== s.selectedIndex) { el.selectedIndex = s.selectedIndex; fireSelectEvents(el); }
    }
    await waitForStable();
    log("Originalzustand wiederhergestellt!");
  } catch (e) { errors.push("Restore: " + e.message); }

  // ================================================
  // ERGEBNIS
  // ================================================
  var elapsed = Math.round((Date.now() - startTime) / 1000);
  var arr = Array.from(allFields.values());
  arr.sort(function (a, b) { if (Math.abs(a.position_y - b.position_y) < 10) return a.position_x - b.position_x; return a.position_y - b.position_y; });

  var result = {
    extractionDate: new Date().toISOString(),
    url: window.location.href,
    pageTitle: document.title,
    formularId: "1400",
    scanVersion: "v39-multipage",
    runtimeSeconds: elapsed,
    totalScans: scanCount,
    totalFields: arr.length,
    visibleFields: arr.filter(function (f) { return f.visible; }).length,
    hiddenFields: arr.filter(function (f) { return !f.visible; }).length,
    pagesScanned: {
      vorblatt: arr.filter(function (f) { return f.id.indexOf("Vorblatt") === 0; }).length,
      seite1: arr.filter(function (f) { return f.id.indexOf("Vorblatt") !== 0 && f.id.indexOf("ke_") !== 0 && f.id !== "menge22" && f.id !== "menge23"; }).length,
      seite2: arr.filter(function (f) { return f.id.indexOf("ke_") === 0 || f.id === "menge22" || f.id === "menge23"; }).length
    },
    fieldTypes: arr.reduce(function (acc, f) { acc[f.fieldType] = (acc[f.fieldType] || 0) + 1; return acc; }, {}),
    actionsPerformed: actionsLog.length,
    errors: errors,
    timedOut: isTimedOut(),
    fields: arr
  };

  var jsonStr = JSON.stringify(result, null, 2);
  try {
    await navigator.clipboard.writeText(jsonStr);
    console.log("%c FERTIG! " + arr.length + " Felder in " + elapsed + "s (alle Seiten) [v39]", "color:green;font-size:20px;font-weight:bold;");
    console.log("%c VB:" + result.pagesScanned.vorblatt + " | S1:" + result.pagesScanned.seite1 + " | S2:" + result.pagesScanned.seite2, "color:green;font-size:14px;");
    if (errors.length > 0) console.log("%c " + errors.length + " Fehler", "color:red;font-size:13px;");
    console.log("%c Strg+V im Chat!", "color:blue;font-size:16px;font-weight:bold;");
  } catch (e) { console.log(jsonStr); }
  return result;
})();
