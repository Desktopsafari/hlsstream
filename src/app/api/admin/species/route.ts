import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { STREAM_ID } from "@/config/constants";
import {
  CONSERVATION_STATUSES,
  toSpeciesCardData,
  type InfoBlock,
  type SpeciesCardRow,
} from "@/lib/species";

const MAX_BLOCKS = 12;

export async function GET() {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("species_cards")
    .select(
      "species_name, scientific_name, conservation_status, photo_path, range_map_path, info_blocks",
    )
    .eq("stream_id", STREAM_ID)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    card: data ? toSpeciesCardData(data as SpeciesCardRow) : null,
  });
}

// Saves the text fields + ordered info blocks. Images are uploaded
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

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("species_cards").upsert(
    {
      stream_id: STREAM_ID,
      species_name: speciesName,
      scientific_name: scientificName,
      conservation_status: status,
      info_blocks: infoBlocks,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stream_id" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
