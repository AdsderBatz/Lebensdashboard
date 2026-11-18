# Lebensdashboard

Webapp (PWA) im Notion-Dark-Stil für Android: tägliche To-Dos mit Fortschrittsdiagramm, Tagesaufgaben mit automatischer Verschiebung, Fokus-Sperre und harte Motivationszitate beim Start. Mehrere Konten, du bist Admin.

## Funktionen

| Bereich | Was es tut |
|---|---|
| **Startbildschirm** | Zufälliges Zitat. Erst nach 3 Sekunden Gedrückthalten geht es weiter. Kommt auch wieder, wenn die App über 30 Minuten im Hintergrund war. |
| **Tägliche To-Dos** | Eigene Liste, gilt jeden Tag neu. Bearbeiten: umbenennen, sortieren, löschen. Gelöschte To-Dos verfälschen die vergangenen Tage im Diagramm nicht. |
| **Statistik** | Prozent erledigt pro Tag: Woche (7 Tage), Monat (30 Tage), Jahr (12 Monatsdurchschnitte). Antippen zeigt Details, Umschalter auf Tabelle. Dazu Ø, Tage mit 100 %, Serie. |
| **Get-Shit-Done List** (Aufgaben heute) | Aufgaben mit Datum. Unerledigte rutschen automatisch auf den nächsten Tag und bekommen einen roten Zähler „↻ X Tage verschoben“. Künftige Aufgaben unter „Geplant“. |
| **Fokus** | Timer, Vollbild-Sperre, Bildschirm bleibt an, Zurück-Taste blockiert. Wer die App verlässt, muss danach angeben: Anruf / Bildschirm aus / andere App. „Andere App“ = Session gebrochen. Notfall-Abbruch: 5 s halten. Alles wird protokolliert. |
| **Konten** | Registrierung per E-Mail + Passwort. Jeder sieht nur seine eigenen Daten (in der Datenbank erzwungen, nicht nur in der Oberfläche). |
| **Admin** | Das **erste** registrierte Konto ist Admin und kann die Zitate verwalten. Niemand kann sich selbst zum Admin machen. |

## Einrichtung (einmalig, ca. 15 Minuten)

### 1. GitHub Pages (Hosting, kostenlos)

1. Auf github.com ein neues Repository **`Lebensdashboard`** anlegen, Sichtbarkeit **Public** (GitHub Pages ist im Gratis-Konto nur für öffentliche Repos verfügbar). Im Code stehen keine Geheimnisse.
2. Alle Dateien aus diesem Ordner hochladen (oder Claude pusht sie).
3. Repo → **Settings → Pages** → Source: *Deploy from a branch* → Branch `main`, Ordner `/ (root)` → **Save**.
4. Nach 1–2 Minuten läuft die App unter `https://DEIN-GITHUB-NAME.github.io/Lebensdashboard/`.

Ohne Schritt 2 läuft die App schon im **lokalen Testmodus** (ein Nutzer, Daten nur auf dem Gerät).

### 2. Supabase (Konten + Datenbank, kostenlos)

1. Auf supabase.com ein Konto und ein **New project** anlegen. Region: *Central EU (Frankfurt)*. Datenbank-Passwort sicher aufbewahren.
2. Links **SQL Editor → New query** → den kompletten Inhalt von `supabase/schema.sql` einfügen → **Run**. Ergebnis: „Success“. (Darf später erneut ausgeführt werden.)
3. **Authentication → URL Configuration**:
   - *Site URL*: deine GitHub-Pages-URL aus Schritt 1.4
   - *Redirect URLs*: dieselbe URL hinzufügen
4. **Pflicht: Authentication → Sign In / Providers → Email** → *Confirm email* ausschalten → Save.
   Grund: Ohne eigenen Mailserver verschickt Supabase Auth-Mails nur an Mitglieder deiner Supabase-Organisation (max. 2 pro Stunde). Freunde bekämen die Bestätigungsmail nie und könnten sich nicht anmelden.
5. Zugangsdaten holen: **Project Settings → API Keys** → den **Publishable key** (`sb_publishable_…`) kopieren. Die **Project URL** steht unter *Project Settings → Data API* bzw. im *Connect*-Dialog.
   ⚠️ Niemals den *Secret key* bzw. *service_role key* verwenden.

### 3. App mit Supabase verbinden

In `js/config.js` die zwei Werte eintragen, speichern, auf GitHub hochladen:

```js
export const CONFIG = {
  SUPABASE_URL: "https://abcdefgh.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_...",
};
```

### 4. Admin werden

**Registriere dich als Erster**, bevor du den Link weitergibst. Das erste Konto wird automatisch Admin. Prüfen: *Profil → Rolle: Admin*.

Falls jemand schneller war, im SQL Editor:

```sql
update public.profiles
set is_admin = (id = (select id from auth.users where email = 'DEINE@EMAIL.at'));
```

### 5. Auf dem Android-Handy installieren

1. Die GitHub-Pages-URL in **Chrome** öffnen.
2. *Profil → Zum Startbildschirm hinzufügen* antippen, oder Chrome-Menü **⋮ → App installieren**.
3. Ab jetzt startet die App mit dem Berg-Symbol als eigenständige App ohne Browserleiste.

## Andere Personen

- Link schicken, sie registrieren sich selbst und sehen nur ihre eigenen Listen.
- Registrierung schließen: **Authentication → Sign In / Providers** → *Allow new users to sign up* ausschalten.
- Konto löschen: **Authentication → Users** → Nutzer löschen (alle seine Daten werden mitgelöscht).
- „Passwort vergessen“ funktioniert ohne eigenen Mailserver nur für Mitglieder deiner Supabase-Organisation, also für dich. Vergisst ein Freund sein Passwort: **Authentication → Users** → Nutzer → *Send password recovery* geht ebenfalls nur mit eigenem Mailserver – am einfachsten Konto löschen und neu registrieren lassen. Für echte Mails: *Authentication → Emails → SMTP Settings* mit einem Anbieter wie Brevo oder Resend einrichten.

## Fokus-Sperre: Grenzen

Eine Webapp darf auf keinem Handy andere Apps blockieren – das ist eine Sicherheitsgrenze von Android. Die App sperrt sich selbst, hält den Bildschirm an und protokolliert jedes Verlassen. Für eine echte Sperre zusätzlich nutzen (Anleitung auch in der App unter *Fokus*):

1. **Fokusmodus** (Digital Wellbeing): ablenkende Apps pausieren, Anrufe bleiben erreichbar.
2. **Nicht stören** mit Ausnahme für Favoriten und wiederholte Anrufer: dringende Anrufe kommen durch.
3. **App anpinnen** (Einstellungen → Sicherheit): bindet das Handy an diese App. Einmal mit einem zweiten Handy testen, ob Anrufe auf deinem Gerät durchkommen.

## Gut zu wissen

- **Supabase-Gratis-Projekte pausieren nach 7 Tagen ohne Aktivität.** Bei täglicher Nutzung passiert das nicht. Sonst im Supabase-Dashboard → Projekt → *Resume project*.
- **Zitate** verwaltet der Admin unter *Profil → Zitate verwalten*. Quellen der Startzitate:
  - David Goggins: Catchphrases und Buch *Can't Hurt Me*
  - Arda Saatçi: Red-Bull-Porträts und -Interviews
  - Jocko Willink, Cameron Hanes, Jerzy Gregorek: ihre bekannten Leitsätze
  - Andrew Tate: weit verbreitete Zitate, nicht an einer Primärquelle geprüft
  - Sprüche ohne Autor: eigene, keine erfundenen Zuschreibungen
- **Updates einspielen:** Dateien ändern, in `sw.js` die Zeile `const CACHE = "ld-v1"` hochzählen (`ld-v2` …), hochladen. Die App lädt online immer zuerst die neueste Version.
- **Uhrzeit/Tag** richten sich nach der Zeitzone des Handys.

## Aufbau

```
index.html            Einstieg, Startbildschirm
manifest.webmanifest  App-Name, Symbol, Vollbild
sw.js                 Offline-Cache
css/app.css           Notion-Dark-Design
js/app.js             Oberfläche, Startbildschirm, Fokus-Sperre
js/store.js           Datenzugriff: Supabase oder lokal
js/chart.js           Balkendiagramm
js/config.js          Supabase-Zugangsdaten
js/quotes-default.js  Startzitate
supabase/schema.sql   Tabellen, Zugriffsregeln (RLS), Admin-Logik, Startzitate
vendor/supabase.js    Supabase-Client 2.119 (lokal, kein CDN)
assets/, icons/       Hintergrund und App-Symbole
```
