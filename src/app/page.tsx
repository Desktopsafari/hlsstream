import HlsPlayer from "@/components/player/HlsPlayer";
import ChatPanel from "@/components/chat/ChatPanel";
import PollCard from "@/components/poll/PollCard";
import SpeciesCard from "@/components/species/SpeciesCard";
import Card from "@/components/ui/Card";
import { SITE_NAME } from "@/config/constants";

export default function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold text-forest sm:text-3xl">
          {SITE_NAME}
        </h1>
        <p className="text-sm text-muted">Live now, streaming 24/7.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <HlsPlayer />

        <Card title="Live Chat" className="flex flex-col lg:h-full">
          <ChatPanel />
        </Card>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 sm:grid-cols-2">
        <Card title="Today's Vote">
          <PollCard />
        </Card>
        <SpeciesCard />
      </div>
    </div>
  );
}
