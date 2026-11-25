# Online pilot · Autoškola BuBu

Samostatný GitHub repozitář `ibo191/Sprava_vozidiel`, Vercel projekt `bubu-sprava-vozidiel` a Supabase projekt `mpknrjfyoivikudvcqut` (Sprava_vozidiel). Veřejný web autoškoly nepoužívá tuto databázi ani tento Vercel projekt.

## Provozní architektura

Vercel hostuje pouze statický React frontend. API běží jako Supabase Edge Function `fleet-api`. Frontend posílá platný Supabase Auth token; API ověřuje uživatele přes Auth a při každém čtení/zápisu ověřuje aktuální aktivní roli v databázi. Instruktoři účet nemají, formulář používá náhodný sdílený klíč. Klient nikdy nedostává serverový klíč.

Pro pilot používáme verzovaný dokument v `private.fleet_runtime`, ne soubor SQLite na Vercelu. Zápisy používají databázový zámek, kontrolu verze a opakování po souběžné změně. Historická zdrojová ID a stávající doménová pravidla se tím zachovávají. Úložiště není určeno pro velké objemy: každá změna přenáší celý dokument; před výrazným růstem flotily je potřeba přechod na jednotlivé tabulky. Starší normalizované migrace z 19.–23. 11. zůstávají návrhem a testovaným referenčním modelem; nejsou aktuálním cloudovým úložištěm. Nespouštějte je dodatečně přes `db push` bez rozhodnutí o migraci a zálohy. Pro nový cloudový projekt platí migrace `20261124091758_cloud_runtime.sql` a případné novější opravy.

Tabulky jsou v neveřejném schématu, mají RLS bez klientských politik a odebraná oprávnění `anon`/`authenticated`. RPC smí volat pouze serverová role v Edge API. Fotografie a doklady jsou v privátním bucketu `fleet-private`; stažení zprostředkuje API po ověření správce. Upload předchází transakci, neúspěšný zápis soubor odstraní. V případě výpadku po uploadu může zůstat nepřiřazený soubor; nemá veřejný přístup a lze jej po porovnání s evidencí odstranit.

`private.fleet_requests` chrání opakované odeslání hlášení a kód potvrzení. `private.fleet_limits` sdílí limity mezi instancemi: 20 nových hlášení/IP/hodinu, 200 nových pokusů pro sdílený formulář/hodinu; opakování již uloženého požadavku vrátí původní potvrzení. Klíč IP je hashovaný se soukromou solí. Limity zmírňují zneužití, nejsou CAPTCHA ani ověření totožnosti. Autor hlášení je povinné neověřené jméno. Správce má odkaz sdílet pouze s instruktory; admin jej může zneplatnit přes `/api/report-link/rotate`. Formulář nikdy nezpřístupňuje ostatní hlášení, náklady ani fotografie.

## Nasazení změn

Frontend potřebuje ve Vercelu pro Production i Preview:

```text
VITE_SUPABASE_URL=https://mpknrjfyoivikudvcqut.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key z dashboardu>
```

Tyto dvě hodnoty jsou veřejná konfigurace. Do `VITE_*` nikdy nepatří `service_role`, databázové heslo ani serverový secret. Vercel build bez konfigurace úmyslně selže. Vercel repozitář slouží automatickým aktualizacím frontendu; Edge API se vydává odděleně. CI ověřuje testy a sestavení. Preview musí mít v privátní konfiguraci API explicitně povolený origin; automaticky nepovolujeme libovolné domény `*.vercel.app`.

```powershell
npm ci
npm test
npm run build
node scripts/edge-bundle.mjs --stage
# Po přihlášení Supabase CLI, pouze do projektu Sprava_vozidiel:
npx supabase functions deploy fleet-api --project-ref mpknrjfyoivikudvcqut --no-verify-jwt
npx vercel@48.10.2 deploy --prod
```

`verify_jwt=false` je potřeba pro formulář bez účtu. Autorizaci provádí funkce sama: správa přes skutečný Auth token, hlášení přes sdílený klíč. Bez této kontroly by změna nebyla bezpečná. Sdílené zdroje se do balíčku připraví skriptem; nekopírovat ručně další variantu pravidel.

Supabase Authentication → URL Configuration: Site URL = veřejná adresa aplikace, Redirect URL = veřejná adresa + `/obnova`. Zapněte minimálně 12 znaků pro hesla, vhodnou politiku registrací (aplikace nemá veřejnou registraci) a podle plánu dostupnou kontrolu uniklých hesel. SMTP a doručitelnost resetovacích e-mailů je nutné ověřit; výchozí Supabase e-mailová služba má omezení. Servisní upozornění jsou pouze v aplikaci, žádné automatické servisní e-maily neběží.

Prvního admina vytvořila jednorázová inicializace se soukromým klíčem a kontrolním součtem importu. Vývojové účty byly převedeny na neaktivní historické identity; hesla ze SQLite se nepřenášela. Soukromý odkaz pro nastavení adminova hesla je mimo Git v `data/deploy/admin-setup.json`. Nesdílet do veřejného repozitáře. Po použití inicializace je její klíč v databázi zneplatněný. Heslo si správce nastaví sám. Nové správcovské účty vytváří pouze admin; nejsou jim automaticky odesílány pozvánky.

## Záloha a obnova

Zálohujte **Postgres i obsah Storage samostatně**, šifrovaně a s omezeným přístupem. Databáze obsahuje také konfiguraci sdíleného klíče a idempotentní požadavky. Záloha jen JSON `body` nestačí. Původní místní SQLite zůstává zachována; po zahájení online provozu už není aktuální zálohou cloudu. Výchozí dokument se nesmí znovu naimportovat přes novější hlášení.

Pro obnovu nejprve zastavte zápisy, obnovte databázi včetně soukromého schématu a přílohy se stejnými cestami do odděleného projektu. Ověřte počty vozidel, tankování, servisů, hlášení, funkci duplicitního požadavku a stažení přílohy přihlášeným správcem. Teprve potom přepněte konfiguraci frontendu. Udržujte zvlášť export seznamu objektů a obsahu bucketu; samotná tabulka `storage.objects` není záloha souborů. Automatický zálohovací úkol zatím není naplánován; před pravidelnou ostrou prací nastavte a ověřte interval a dobu uchování.

## Rozsah pilotu a omezení

Tankování a servisy byly jednorázově přeneseny z místní evidence. Původní plný importovací skript aktualizuje pouze místní SQLite, **nikoliv cloud**. Nový online požadavek přes tlačítko spouští na zapnutém PC `npm run km:worker` a přenáší do cloudu výhradně datované odpočty km z tankování / konce jízd. Nevkládá nové tankovací ani servisní záznamy a nepřenáší údaje žáků. Fronta, stav a pracovní lease jsou ve verzovaném privátním dokumentu; scoped klíč má v něm jen hash. Endpointy importéru mají vlastní kontrolu klíče a nepřijímají správcovské příkazy. Další konfigurace a provoz viz README. Denní synchronizace ani odchozí zápis do Moje Autoškola nejsou aktivní. Termíny plánů se nepřepočítávají odhadováním z neúplné historie; správce je musí ověřit a doplnit.

Před širším ostrým používáním zbývá ověřit fyzický mobilní fotoaparát, doručování resetu přes vlastní SMTP, pravidelné zálohy a obnovu, monitoring/chybové alerty, pravidla uchování fotografií a kontrolu příloh proti škodlivému obsahu. Kontrola MIME/podpisu není antivir. Otestujte skutečné pracovní postupy s malou skupinou instruktorů a správcem. Aktuální nasazení je pilot pro toto testování.
