import test from "node:test";
import { check, fresh, json, load, req } from "./support/helpers.mjs";

const publicRoute = await load("app/api/species/route.ts");
const adminRoute = await load("app/api/admin/species/route.ts");

const publicCard = async () => (await json(await publicRoute.GET())).body.card;
const adminGet = async () => json(await adminRoute.GET());
const save = async (body) =>
  json(await adminRoute.PUT(req("PUT", "/api/admin/species", { speciesName: "TEST frog", infoBlocks: [], ...body })));

test("a card without a residents list is unchanged (and the site works before the SQL is run)", async () => {
  const fake = await fresh({ residentsColumn: false });
  fake.addSpeciesCard({ info_blocks: [{ title: "DIET", body: "TEST crickets" }] });
  const card = await publicCard();
  check("public card still loads without the column", card && card.speciesName === "TEST frog" && card.infoBlocks.length === 1);
  check("...with an empty residents list", Array.isArray(card.residents) && card.residents.length === 0);
  const admin = await adminGet();
  check("admin says the column is missing", admin.status === 200 && admin.body.residentsSupported === false);
  check("saving without residents still works", (await save({})).status === 200);
  const refused = await save({ residents: [{ label: "Frog 1", name: "" }] });
  check("saving residents explains which SQL to run", refused.status === 400 && /species_residents\.sql/.test(refused.body.error));

  const fake2 = await fresh();
  fake2.addSpeciesCard({ residents: null });
  check("column present but null: empty list", (await publicCard()).residents.length === 0);
});

test("residents are saved in order, validated, and shown with blank names", async () => {
  const fake = await fresh();
  const row = fake.addSpeciesCard();
  const ok = await save({ residents: [
    { label: "Frog 1", name: "  Basil " },
    { label: "Frog 2", name: "" },
    { label: "", name: "" },
    { label: "Neon tetras", name: "The Squad" },
  ] });
  check("saved", ok.status === 200);
  check("stored trimmed, empty rows dropped, order kept", JSON.stringify(row.residents) === JSON.stringify([
    { label: "Frog 1", name: "Basil" }, { label: "Frog 2", name: "" }, { label: "Neon tetras", name: "The Squad" },
  ]));
  const card = await publicCard();
  check("public card gets them", card.residents.length === 3 && card.residents[1].name === "");

  check("label max 30", (await save({ residents: [{ label: "x".repeat(31), name: "" }] })).status === 400);
  check("name max 40", (await save({ residents: [{ label: "Frog", name: "x".repeat(41) }] })).status === 400);
  check("a name needs a label", (await save({ residents: [{ label: "", name: "Basil" }] })).status === 400);
  const twelve = Array.from({ length: 12 }, (_, i) => ({ label: `Frog ${i + 1}`, name: i % 2 ? "" : `TEST name ${i}` }));
  check("12 allowed", (await save({ residents: twelve })).status === 200 && row.residents.length === 12);
  check("13 refused", (await save({ residents: [...twelve, { label: "Frog 13", name: "" }] })).status === 400);
  check("emptying the list works", (await save({ residents: [] })).status === 200 && row.residents.length === 0);
});
