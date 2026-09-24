# Matteo Apartment Finder (web)

Statyczna strona z ogłoszeniami wynajmu mieszkań i pokoi w Krakowie (OLX, Otodom, Morizon, Nieruchomosci-online).

- `scraper/` – Node + Playwright, uruchamiany co godzinę przez GitHub Actions (`.github/workflows/scrape.yml`), zapisuje `docs/data/listings.json` i `docs/data/meta.json`.
- `docs/` – strona (GitHub Pages). Filtry, ulubione i ukryte trzymane są w przeglądarce (localStorage).

Lokalnie: `npm install`, `npx playwright install chromium` (albo `PW_CHANNEL=chrome`, gdy jest zainstalowany Chrome), `npm run scrape`, `npm run serve` i otwórz http://localhost:5174.

Facebook nie jest częścią wersji webowej (wymaga osobistej sesji użytkownika) – jest w aplikacji desktopowej.
