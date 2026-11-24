> Online pilot: samostatný Vercel + Supabase. Aktuální postup a omezení nasazení: [DEPLOYMENT.md](DEPLOYMENT.md). Níže popsané demo účty a SQLite se týkají pouze lokálního režimu.

# BuBu · Hlášení závad a správa servisů

Samostatná interní aplikace v češtině. Aktuální rozsah od 24. 11. 2026: příjem hlášení závad a nehod přes odkaz **bez instruktorských účtů**, servisní plány, servisní historie a náklady. Tankování je pouze čtecí import z Moje Autoškola a slouží také jako podklad kontroly km. Zápis tankování a provozních odpočtů v aplikaci, učitelské profily a odchozí přenos do Moje Autoškola jsou odstraněné/uzavřené. Starší lokální učitelská ID zůstávají pouze u historických záznamů; přihlášení je jim zakázáno.

## Spuštění

Požadavky: Node.js 24.17+ řady 24 a npm.

```powershell
npm ci
npm run dev
```

Správa: **http://127.0.0.1:5173**. API: `127.0.0.1:3001`. Oba procesy poslouchají jen na místním počítači. Pro sestavenou lokální aplikaci: `npm run build`, potom `npm start` a http://127.0.0.1:3001. Ukončení Ctrl+C.

| Lokální účet | Role | Výchozí heslo |
|---|---|---|
| admin@bubu.local | Admin | BubuDemo2026! |
| spravce@bubu.local | Správce | BubuDemo2026! |

Tyto účty, místní reset hesla vracející jednorázový token a SQLite jsou **vývojový režim, ne produkční zabezpečení**. Toto platí pro místní režim bez proměnných `VITE_SUPABASE_*`. Online pilot používá skutečný Supabase Auth, Postgres a privátní Storage; podrobnosti a omezení jsou v [DEPLOYMENT.md](DEPLOYMENT.md).

## Formulář pro instruktory

Správce otevře **Přehled / Závady a hlášení → Odkaz pro hlášení**. Odkaz lze zkopírovat nebo otevřít v samostatném okně. Má podobu `/hlaseni#<náhodný-klíč>`. Instruktor nepotřebuje účet ani přihlášení; držitel odkazu vybere aktivní vozidlo, typ Závada/Nehoda, závažnost, popis, povinné jméno a případně fotografii. Jméno je povinné a není ověřenou identitou. Tlačítko **Vyfotit** používá mobilní vstup `capture="environment"`; dostupnost fyzického fotoaparátu závisí na zařízení. JPG/PNG do 5 MB, s náhledem před odesláním.

Odkaz s klíčem sdílejte jen s oprávněnými lidmi. Klíč je v URL fragmentu, který se neposílá v HTTP URL; server jej ověřuje v hlavičce. Ve vývojovém režimu je uložen v interní tabulce SQLite `settings`. Přes odkaz je dostupný pouze minimální výběr aktivních vozidel a odeslání hlášení. Seznam hlášení, fotografie, náklady a správní API zůstávají přihlášeným správcům. Anonymní fotografie se nenahrávají do veřejného adresáře; ukládají se spolu s hlášením v jedné transakci.

Odeslání vytváří hlášení ve stavu Nové a záznam auditu bez falešného uživatelského účtu. Jedinečný požadavek a otisk obsahu chrání před duplicitou při opakování po výpadku; změněné tělo se stejným klíčem je odmítnuto. Lokální ochrana dále zahrnuje limit 20 nových hlášení/IP/hodinu, skryté pole proti jednoduchým botům, kontrolu typu/podpisu fotografie a serverovou validaci. Omezení běží v paměti jednoho procesu; před internetovým provozem je nutné nahradit jej sdíleným limiterem a nastavit důvěryhodné proxy hlavičky, ochranu proti zneužití a řízenou výměnu sdíleného klíče. Přílohy nejsou antivirově kontrolované.

**Lokální odkaz funguje jen na tomto počítači.** Pro přístup instruktorů z mobilů je potřeba pozdější autorizované nasazení na HTTPS. `noindex` není náhradou přístupových pravidel. Automatické e-maily ani jiné oznámení správci se nepředstírají; nová hlášení se zobrazují v aplikaci. Správcovský přehled se při otevřeném okně obnovuje po 30 sekundách a při návratu do okna.

## Správa flotily

- Přehled začíná otevřenými hlášeními. Správce hlášení zpracuje, změní stav a případně propojí se servisem stejného vozidla. Nebezpečné vozidlo lze odstavit; návrat do provozu potvrzuje pouze správce/admin. Vyřešení hlášení samo vozidlo neuvolňuje.
- Vozidla mají skupiny **Auto, Moto, Přívěsy**, unikátní RZ bez mezer a rozdílu velikosti písmen, rok a datované odečty. Nedatované tachometry ze zdroje jsou oddělené; datum importu se nevydává za datum odečtu.
- **Vozidla → Vyřadit** uloží datum a důvod a odstraní vozidlo z aktivní nabídky, nikoliv historii tankování, servisů a hlášení. Změna je auditovaná. Dočasné odstavení je samostatný stav.
- Servisní plán sleduje km a kalendářní dobu současně, podle prvního dosaženého limitu, s předstihem a zodpovědnou osobou. Objednání je oddělené a nezakryje překročení. Chybějící/staré km jsou označené; hranice stáří odečtu je 30 dní. Známý překročený limit má přednost před neúplností druhého podkladu.
- Servisní záznam obsahuje datum, známé/neznámé km, více úkonů a materiálů, důvody, cenu položek nebo celku, dodavatele, poznámku a doklad. Aktualizace odpovídajících plánů vyžaduje potvrzení; chybějící podklady se neodhadují a historický servis nepřepíše novější základ. Preventivní údržba automaticky nevytváří závadu.
- **Servisní náklady** zobrazují náklady podle vozidla a období a neúplné ceny. Intervaly výměn jen při alespoň dvou odpovídajících záznamech. Neexistující servisní záznamy se nevydávají za skutečné nulové náklady.
- **Servisní historie → Upravit servis** opraví i importovaný záznam: datum, km, úkony, díly, ceny, dílnu, poznámku a doklad. Původní ID/zdroj zůstávají a historie změn uchová stav před opravou. Změna km nahradí původní servisní odečet; rozpor jde do Závady a hlášení. Změna podkladu již potvrzeného plánu vyžádá jeho kontrolu, nepřepisuje termíny automaticky. Souběžnou zastaralou úpravu server odmítne. Opakovaný import místní opravu nezruší. Opravy se neposílají zpět do Moje Autoškola.
- **Mazání km:** Závady a hlášení obsahují evidenci všech odpočtů i nedatovaných tachometrů. Správce zadá důvod smazání. Odpočet se vyřadí z chronologie, původní tankování/servis i cena zůstanou. Omylem smazaný odpočet lze obnovit po kontrole chronologie; nový import jej sám neobnoví. Oprava servisní ceny smazané km nevrací; návrat opravených km je výslovný.
- **Mazání plánů:** u plánu je Smazat, s povinným důvodem. Plán přestane upozorňovat a zmizí z návrhů servisů, historie servisů zůstane. Seznam smazaných plánů umožňuje obnovu; zastaralý otevřený formulář smazaný plán znovu nevytvoří.
- **Další servis při zápisu:** přímo pod úkony/díly lze vybrat další plán, interval km/měsíců, samostatný příští limit, předstih a zodpovědnou osobu. Motorový olej má pro nový plán předvyplněno 15 000 km, hodnotu lze změnit. Předstih je viditelně upravitelný (výchozí 1 000 km / 14 dní); časový interval nemá odhadnutou výchozí hodnotu. U neznámých či konfliktních km se další kilometrový základ nevymýšlí; stávající známý termín se neodsune a plán čeká na doplnění.
- **Díly a úkony:** sjednocený katalog z historie poskytuje nabídku při zápisu a počty různých servisů/výměn podle vozidla. Varianty spojkových sad se sledují pod jedním typem, původní název/výrobce zůstává v záznamu. Jednoznačné překlepy se sjednocují, různé součástky se neslučují. Opravy, kontroly, materiál a neurčené zásahy se odlišují od výměn. Interval vyžaduje alespoň dvě potvrzené výměny; bez známých km neukazuje odhadnutou vzdálenost. Nejasné historické názvy se neslučují bez ověření.
- **Tankování** je čtecí seznam z importu. Ruční vytvoření, úpravy a kontrola papírových účtenek jsou uzavřené i na serveru. Samostatný ruční provozní odečet je uzavřený; km přicházejí z importů a doložených servisů. Správce může vyřešit již evidovaný rozpor.
- Rozpory km jsou pouze v **Závady a hlášení**. Případ ukáže zdrojové záznamy, data, hodnoty a rozdíl. Různé km stejného dne bez času znamenají neověřené pořadí, ne automaticky chybu. Pokles mezi dny je popsán konkrétně. Aplikace sama nevybírá odhadnutého vítěze.
- CSV tankování a servisů obsahuje původ dat, BOM a středníky; buňky začínající znakem vzorce jsou ošetřené. Exportuje se celá evidence.

## Čtecí import z Moje Autoškola

Přenos je jednorázový, ručně spuštěný a pouze **Moje Autoškola → tato aplikace**. Žádná odchozí synchronizace ani denní zapisovací program není implementován nebo naplánován. Sběrač používá dosavadní Playwright instalaci a přihlášený profil sousedního projektu `Dashboard`; nepřepisuje jeho exporty, neodesílá formuláře a používá GET/HEAD. Pokud přihlášení vyprší, musí je uživatel obnovit ručně; CAPTCHA se neobchází. GPS a údaje žáků se nesbírají.

```powershell
npm run fetch:moje
npm run import:moje                       # kontrola bez zápisu
npm run import:moje -- --apply            # zápis a aktivace oddělené DB
npm run fetch:services
npm run import:moje -- --source=data/imports/moje-autoskola-with-services.json
npm run import:moje -- --source=data/imports/moje-autoskola-with-services.json --apply
```

Import používá `data/bubu-imported.sqlite`; původní `data/bubu.sqlite` včetně ručních demo záznamů zůstala zachovaná. `data/active-database.json` určuje aktivní databázi, explicitní `BUBU_DEMO_DB` má přednost pro testy. Návrat k demu: `{"database":"bubu.sqlite"}` v tomto souboru. Server přepne databázi a zruší předchozí relace. Před aktualizací existující importované DB se vytvoří konzistentní záloha do `data/backups/`.

Dosavadní import: 21 vozidel (15 aktivních), 240 tankování, 16 servisů s evidovanými cenami celkem 168 255 Kč. U 14 servisů chybí km, u 19 tankování cena; hodnoty zůstaly neznámé. Historie začíná v březnu 2025. Ceny jsou evidované údaje ze zdroje, ne ověření skutečné úhrady. Jeden servis vyřazené motorky byl při chybějícím ID spárován přes jedinou přesnou shodu označení. Nejednoznačnost import zastaví.

Zdrojová ID chrání před opakováním. Import nepřepisuje ruční opravy existujících položek; doplňuje pouze nová ID. Změny již importovaných záznamů ve zdroji zatím automaticky nepřebírá. Původní učitel je pouze metadata importu, nevytváří se mu přihlášení. Názvy vozidel zůstávají podle zdroje; samostatná značka/model se z jednoho označení nevydává za ověřený údaj. Servisní plány se importem historie automaticky neposouvají.

## Architektura a testy

React/TypeScript/Vite ve `src/`, Node API v `server/`. `src/domain.ts` obsahuje společná pravidla; `server/reporting.ts` příjem přes odkaz; `server/app.ts` přihlášenou správu a role. SQLite ukládá lokální verzovaný stav, oddělené hashované přístupy (scrypt), nastavení a idempotentní požadavky. Všechny podstatné změny jsou transakční a auditované. Přihlášení má HttpOnly/SameSite Strict cookie s 8hodinovou platností a relace v paměti. Restart odhlásí správce. Vnější data a přílohy jsou v ignorované složce `data/`; necommitovat ani nezveřejňovat.

```powershell
npm test
npm run build
npx tsx scripts/verify-public-report.mjs
npm run test:e2e
```

API a doménové testy používají databáze v paměti. Ověřují sdílený odkaz, minimální zveřejněná metadata, soukromé přílohy, atomické odeslání, duplicitní požadavky, limity, role, importy, servisní intervaly a historické km. Izolovaný test prohlížeče zapisuje výhradně do paměti a používá náhodný místní port. Plný E2E používá oddělenou `data/e2e.sqlite`; před ním zastavte běžný dev server. Konfigurace odmítá opětovné použití běžícího serveru, aby test nezasáhl reálná data. Výchozí prohlížeč je instalovaný Microsoft Edge; alternativně nainstalujte Chromium a nastavte `BUBU_TEST_BROWSER=chromium`.

## Záloha a budoucí nasazení

Pro místní zálohu zastavte procesy a zkopírujte **celou složku data**, včetně případných `-wal`/`-shm`, importované databáze, nastavení odkazu a příloh, na chráněné úložiště. Obnovu dělejte při vypnutém serveru a pravidelně ji ověřte v oddělené složce.

Online pilot má vlastní Vercel projekt a vlastní Supabase projekt, oddělený od veřejného webu. SQL migrace jsou v `supabase/migrations/`, ověřené na PostgreSQL jádře PGlite s náhradou auth/storage kontraktů. Online pilot používá verzovaný privátní dokument podle migrace `cloud_runtime`; starší normalizovaný model je referenční návrh. Všechny veřejné tabulky mají RLS, správní čtení je omezené na správce/admina a klientské zápisy uzavřené. Přijetí hlášení bez účtu vyžaduje důvěryhodný serverový endpoint, nikoliv anonymní přístup k tabulkám. Migrace podporují anonymního autora a privátní idempotentní evidenci.

Online adaptér již poskytuje Supabase Auth, soukromé Storage, povolené originy, sdílené limity a výměnu klíče. Lokální cookie přihlašování se na internetu nepoužívá. Dále ověřit celé RLS na skutečném stacku, kontrolu příloh, monitoring a obnovu záloh. Databázi i soubory Storage je nutné zálohovat samostatně. Servisní upozornění zůstávají v aplikaci. Automatický příchozí import lze řešit později samostatným čtecím procesem; žádné odesílání tankování do Moje Autoškola se neplánuje.

Online pilot je připraven pro samostatný Vercel a Supabase projekt. Postup, aktuální architektura a zbývající provozní kroky: [DEPLOYMENT.md](DEPLOYMENT.md). Kniha jízd, GPS, NFC, OCR, nativní aplikace a další integrace nejsou součástí rozsahu.
