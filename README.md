# Daily Katori

A personal food diary for Indian meals, with local search, recipes, household portions, weekly insights and backups. The static app in `site/` runs without a backend or account.

## Run and test

With Node.js 22, run `npm start` and open `http://127.0.0.1:4173/Calorie-counter/`. Run `npm test` for catalog search, nutrition arithmetic, weekly coverage, and backup checks. The app has no runtime package dependencies.

## Food data

- Generic entries cite [USDA FoodData Central](https://fdc.nal.usda.gov/api-guide/#licensing) records. Survey dishes are reference estimates, including when used as a proxy for a delivery order.
- Homemade entries list their ingredients, assumptions and batch basis. Use **My foods → View → Adapt recipe** to enter your recipe and cooked yield. Weigh your own katori once and save it as a personal portion.
- Manufacturer entries match the linked Indian labels for specific variants. The MillD entry measures dry atta. The Serious Mass and whey entries are for powder prepared without any separately added milk. Check your exact pack and save its figures using the custom label form if they differ. The BCAA and restaurant shortcuts accept the label or menu figures you enter.
- To rebuild the bundled catalog, run `python scripts/build_catalog.py --help` for the pinned USDA archives and command arguments.
- **Settings → Personal catalog import** accepts JSON in the supplied sample format. Nutrients are per 100 g or 100 mL. Use a unique personal ID and preserve source details and applicable terms. Missing nutrient fields are displayed as unknown.

## Storage and deployment

Diary entries, preferences and personal foods live in IndexedDB. Export a JSON backup from Settings before moving to a different browser or device. Restore previews the record counts and replaces the local diary only after confirmation. CSV is for analysis.

Enable **Settings → Pages → Build and deployment → GitHub Actions** in the GitHub repository. The included workflow runs the tests and publishes only `site/` on pushes to `main`. It can also be run manually.

The service worker caches the complete app shell and catalog after the first successful load. The workflow gives each deployed revision its own cache. Close the app's open tabs to let the browser activate a waiting update. The diary survives updates on the same browser and site origin.

## Nutrition and meal previews

Open **Nutrition** for daily meal breakdowns, food contributors, and 7- or 30-day trends. Averages include only complete days with a recorded value on every food for the nutrient being averaged. Earlier diary entries retain their saved nutrient values.

Daily and weekly reports compare logged intake with personal targets and optional [WHO adult references](https://www.who.int/news-room/fact-sheets/detail/healthy-diet) for fiber, sodium, and potassium. Color is paired with a text status. Weekly reference comparisons use at least three fully covered days. Potassium highlights compare dietary intake with a reference.

Set your own targets in **Settings**. In **Nutrition**, choose a meal to compare adding, reducing, or swapping a food. Previews calculate meal and day totals without editing the diary. Suggested changes use repeated patterns on fully covered days and respect your selected dietary preference. In **Weekly review**, preview and copy a summary you can share manually.
