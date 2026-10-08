import Image from "next/image";
import HlsPlayer from "@/components/player/HlsPlayer";
import ChatPanel from "@/components/chat/ChatPanel";
import PollCard from "@/components/poll/PollCard";
import SpeciesCard from "@/components/species/SpeciesCard";
import ViewerCount from "@/components/viewers/ViewerCount";
import SuggestionEventCard from "@/components/event/SuggestionEventCard";
import Card from "@/components/ui/Card";
import { SITE_NAME } from "@/config/constants";

export default function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-1">
        <h1>
          {/*
            Real file size (1052x308) so the browser reserves the right space
            before it loads. The height is capped per breakpoint (width follows
            from the aspect ratio) so the player stays near the top on phones;
            `sizes` matches the rendered widths so small screens don't download
            the full-size file.
          */}
          <Image
            src="/logo.png"
            alt={SITE_NAME}
            width={1052}
            height={308}
            preload
            sizes="(min-width: 1024px) 328px, (min-width: 640px) 274px, 192px"
            className="block h-14 w-auto max-w-full object-contain sm:h-20 lg:h-24"
          />
        </h1>
        <p className="text-sm text-muted">Live now, streaming 24/7.</p>
      </div>

      {/*
        One grid for everything below the title, so the mobile stacking
        order (species -> chat -> poll) and the desktop pairing (player+chat
        row, poll+species row) can both be expressed with plain `order`
        utilities instead of two separate grids. Source/DOM order below is
        deliberately unchanged (player, chat, poll, species) -- at `lg` every
        item resets to `order-none`, so desktop falls back to that DOM order,
        which auto-places into the same two 2-up rows as before.
      */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-8 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-2">
          <HlsPlayer />
          <ViewerCount />
        </div>

        <Card
          title="Live Chat"
          className="order-2 flex flex-col lg:order-none lg:h-full"
        >
          <ChatPanel />
        </Card>

        {/*
          Suggestion-event card + poll. On mobile this wrapper is
          `display: contents`, so both are plain grid items and the event
          card (order-1, earlier in the DOM than the species card) lands
          right under the video. On desktop it becomes a column so the event
          card stacks directly above the poll. The event card renders
          nothing when no event is active, leaving just the poll -- the same
          size and position as before.
        */}
        <div className="contents lg:flex lg:flex-col lg:gap-8 lg:self-start">
          <SuggestionEventCard />

          <Card
            title="Today's Vote"
            className="order-3 self-start lg:order-none lg:self-auto"
          >
            <PollCard />
          </Card>
        </div>

        <div className="order-1 self-start lg:order-none">
          <SpeciesCard />
        </div>
      </div>
    </div>
  );
}
