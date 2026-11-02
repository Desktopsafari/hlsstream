import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { loadCategories, pushKeys } from "@/lib/push";

// What the "Notify me" modal needs to offer push: whether it's available at
// all (keys set and tables created), the public VAPID key, and the categories.
// When it isn't, the modal simply doesn't show the push option.
export async function GET() {
  const keys = pushKeys();
  if (!keys) return NextResponse.json({ supported: false });

  const { categories, error } = await loadCategories(createServiceRoleClient());
  if (error || categories.length === 0) return NextResponse.json({ supported: false });

  return NextResponse.json({
    supported: true,
    publicKey: keys.publicKey,
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
  });
}
