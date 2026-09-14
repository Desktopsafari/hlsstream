import HlsPlayer from "@/components/player/HlsPlayer";
import { SITE_NAME } from "@/config/constants";

export default function HomePage() {
  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6 sm:py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold sm:text-2xl">{SITE_NAME}</h1>
        <p className="text-sm text-neutral-400">Live now, streaming 24/7.</p>
      </div>
      <HlsPlayer />
    </section>
  );
}
