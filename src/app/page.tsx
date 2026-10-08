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
        <h1 className="font-heading text-2xl font-semibold text-forest sm:text-3xl">
          {SITE_NAME}
        </h1>
        <p className="text-sm text-muted">Live now, streaming 24/7.</p>
      </div>

      {/*
        Below `lg` both column wrappers are `display: contents`, so every card
        is a direct grid item and the mobile/tablet stacking (video -> event ->
        species -> chat -> poll) comes from the `order` utilities, exactly as
        before. At `lg` the wrappers become two independent columns, so the
        event card and poll follow the video directly instead of waiting for
        the whole row to finish -- the chat card gets taller once someone
        joins it, and in a shared row that left a gap under the stream.
        The event card renders nothing when no event is active.
      */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-8 lg:grid-cols-[1fr_360px] lg:items-start">
        <div className="contents lg:flex lg:flex-col lg:gap-8">
          <div className="flex flex-col gap-2">
            <HlsPlayer />
            <ViewerCount />
          </div>

          <SuggestionEventCard />

          <Card title="Today's Vote" className="order-3 self-start lg:order-none lg:self-auto">
            <PollCard />
          </Card>
        </div>

        <div className="contents lg:flex lg:flex-col lg:gap-8">
          {/*
            Before joining, the chat card is as tall as the video column, as
            it was when the two shared a row. That height is the video's 16:9
            height at the current column width (page width capped at the 72rem
            container, minus 3rem padding, the 22.5rem chat column + gap) plus
            the viewer-count line (1rem text + 0.5rem gap) -- keep this in
            step with the grid columns above and the video wrapper. Once
            joined, the card grows past it as needed.
          */}
          <Card
            title="Live Chat"
            className="order-2 flex flex-col lg:order-none lg:min-h-[calc((min(100vw,72rem)_-_27rem)_*_0.5625_+_1.5rem)]"
          >
            <ChatPanel />
          </Card>

          <div className="order-1 self-start lg:order-none lg:self-auto">
            <SpeciesCard />
          </div>
        </div>
      </div>
    </div>
  );
}
