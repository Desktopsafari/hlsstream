import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { STREAM_ID } from "@/config/constants";
import {
  CONSERVATION_STATUSES,
  NAMES_SQL_HINT,
  loadSpeciesCardRow,
  parseNames,
  toSpeciesCardData,
  type InfoBlock,
} from "@/lib/species";

const MAX_BLOCKS = 12;

export async function GET() {
  const supabase = createServiceRoleClient();
  const { row, namesSupported, error } = await loadSpeciesCardRow(supabase);

  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
  return NextResponse.json({
    card: row ? toSpeciesCardData(row) : null,
    namesSupported,
  });
}

// Saves the text fields + ordered info blocks + names block. Images are uploaded
// separately via /api/admin/species/image.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);

  const speciesName = typeof body?.speciesName === "string" ? body.speciesName.trim() : "";
  const scientificName =
    typeof body?.scientificName === "string" && body.scientificName.trim()
      ? body.scientificName.trim()
      : null;
  const status = body?.conservationStatus || null;

  if (speciesName.length === 0 || speciesName.length > 80) {
    return NextResponse.json(
      { error: "Species name is required (80 characters max)." },
      { status: 400 },
    );
  }
  if (scientificName && scientificName.length > 100) {
    return NextResponse.json({ error: "Scientific name is too long." }, { status: 400 });
  }
  if (status && !CONSERVATION_STATUSES.some((s) => s.value === status)) {
    return NextResponse.json({ error: "Invalid conservation status." }, { status: 400 });
  }

  const rawBlocks: unknown = body?.infoBlocks ?? [];
  if (!Array.isArray(rawBlocks)) {
    return NextResponse.json({ error: "infoBlocks must be a list." }, { status: 400 });
  }
  const infoBlocks: InfoBlock[] = rawBlocks
    .map((b) => ({
      title: typeof b?.title === "string" ? b.title.trim() : "",
      body: typeof b?.body === "string" ? b.body.trim() : "",
    }))
    .filter((b) => b.title || b.body);

  if (infoBlocks.length > MAX_BLOCKS) {
    return NextResponse.json({ error: `Up to ${MAX_BLOCKS} info blocks.` }, { status: 400 });
  }
  if (infoBlocks.some((b) => b.title.length > 40 || b.body.length > 500)) {
    return NextResponse.json(
      { error: "Block titles max 40 characters, bodies max 500." },
      { status: 400 },
    );
  }

  const names = parseNames(body?.namesHeading, body?.names);
  if (!names.ok) {
    return NextResponse.json({ error: names.error }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  // Until supabase/species_names.sql is run there are no names columns:
  // save everything else, and only refuse if names were actually entered.
  const { namesSupported } = await loadSpeciesCardRow(supabase);
  if (!namesSupported && names.names.length > 0) {
    return NextResponse.json({ error: NAMES_SQL_HINT, code: "names_unsupported" }, { status: 400 });
  }

  const { error } = await supabase.from("species_cards").upsert(
    {
      stream_id: STREAM_ID,
      species_name: speciesName,
      scientific_name: scientificName,
      conservation_status: status,
      info_blocks: infoBlocks,
      ...(namesSupported ? { names_heading: names.heading, names: names.names } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stream_id" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
