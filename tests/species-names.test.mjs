import test from "node:test";
import { check, fresh, json, load, req } from "./support/helpers.mjs";

const publicRoute = await load("app/api/species/route.ts");
const adminRoute = await load("app/api/admin/species/route.ts");

const publicCard = async () => (await json(await publicRoute.GET())).body.card;
const adminGet = async () => json(await adminRoute.GET());
const save = async (body) =>
  json(await adminRoute.PUT(req("PUT", "/api/admin/species", { speciesName: "TEST frog", infoBlocks: [], ...body })));

test("no names = nothing shown, and the site works before supabase/species_names.sql is run", async () => {
  const fake = await fresh({ namesColumns: false });
  fake.addSpeciesCard({ info_blocks: [{ title: "DIET", body: "TEST crickets" }] });
  const card = await publicCard();
  check("public card still loads without the columns", card && card.speciesName === "TEST frog" && card.infoBlocks.length === 1);
  check("...with no names", Array.isArray(card.names) && card.names.length === 0);
  const admin = await adminGet();
  check("admin says the columns are missing", admin.status === 200 && admin.body.namesSupported === false);
  check("saving without names still works", (await save({})).status === 200);
  check("an empty names box still saves", (await save({ namesHeading: "Frog names", names: "  \n " })).status === 200);
  const refused = await save({ names: "Kiwi" });
  check("saving names explains which SQL to run", refused.status === 400 && /species_names\.sql/.test(refused.body.error));

  const fake2 = await fresh();
  fake2.addSpeciesCard();
  const empty = await publicCard();
  check("columns present, no names: empty list", empty.names.length === 0 && empty.namesHeading === "Frog names");
});

test("names box: one per line, blank lines ignored, trimmed, order kept, plain text", async () => {
  const fake = await fresh();
  const row = fake.addSpeciesCard();
  const ok = await save({ namesHeading: "  Frog   names ", names: "  Kiwi \r\n\n\nFrog Y\n   \n<b>Bold?</b>\n" });
  check("saved", ok.status === 200, JSON.stringify(ok.body));
  check("stored trimmed, blanks dropped, order kept", JSON.stringify(row.names) === JSON.stringify(["Kiwi", "Frog Y", "<b>Bold?</b>"]));
  check("heading trimmed", row.names_heading === "Frog names");
  const card = await publicCard();
  check("public card gets heading and names (HTML kept as plain text)", card.namesHeading === "Frog names" && card.names.join("|") === "Kiwi|Frog Y|<b>Bold?</b>");
  const admin = await adminGet();
  check("admin gets them back to refill the box", admin.body.namesSupported === true && admin.body.card.names.length === 3);

  check("blank heading falls back to the default", (await save({ namesHeading: "  ", names: "Kiwi" })).status === 200 && row.names_heading === "Frog names");
  check("custom heading", (await save({ namesHeading: "Fish names", names: "Nemo" })).status === 200 && row.names_heading === "Fish names");
  check("heading max 30", (await save({ namesHeading: "x".repeat(31), names: "Kiwi" })).status === 400);
  check("name max 40", (await save({ names: "x".repeat(41) })).status === 400);
  check("40 is fine", (await save({ names: "x".repeat(40) })).status === 200);
  const twelve = Array.from({ length: 12 }, (_, i) => `TEST name ${i + 1}`).join("\n");
  check("12 names allowed", (await save({ names: twelve })).status === 200 && row.names.length === 12);
  check("13 refused", (await save({ names: `${twelve}\nTEST name 13` })).status === 400);
  check("12 names plus blank lines is still 12", (await save({ names: `${twelve}\n\n\n` })).status === 200);
  check("emptying the box hides the section", (await save({ names: "" })).status === 200 && row.names.length === 0 && (await publicCard()).names.length === 0);
});
