import Link from "next/link";
import { LegalLayout, LegalList, LegalSection } from "@/components/legal/LegalLayout";
import { SITE_NAME } from "@/config/constants";

export const metadata = {
  title: `Privacy notice — ${SITE_NAME}`,
};

// Keep this page accurate: any change that collects, stores, shares, or keeps
// visitor data differently must update it in the same change (see AGENTS.md).
const LAST_UPDATED = "November 5, 2026";
const OWNER = "DesktopSafari";
const CONTACT_EMAIL = "desktopsafari@gmail.com";

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy notice" updated={LAST_UPDATED}>
      <section className="rounded-xl border border-moss bg-card p-5 shadow-sm">
        <h2 className="mb-2 font-heading text-lg font-semibold text-forest">The short version</h2>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-ink">
          <li>
            You can watch the stream without giving us anything. There are no ads, no analytics,
            and no tracking cookies.
          </li>
          <li>
            If you chat, your name and messages are visible to everyone in chat, and we delete
            them after about 30 days.
          </li>
          <li>
            Your browser keeps a random ID so one browser gets one vote and chat can tell people
            apart. About a week after a poll closes, we cut the link between that ID and your
            vote.
          </li>
          <li>
            Your email address is only used if you sign up for updates (including the support-page
            notice), and every update has an unsubscribe link.
          </li>
          <li>
            If you turn on phone or browser notifications, we store only your device&rsquo;s push
            address and the categories you chose, never your name or email. You can turn them off
            any time.
          </li>
          <li>
            &ldquo;Take photo&rdquo; makes the photo in your own browser: it never reaches our
            servers. A clip you save is kept on our server for 24 hours behind a private link,
            then deleted, unless we choose it for the public gallery.
          </li>
          <li>
            Our server keeps ordinary access logs (including IP addresses) for about a week.
          </li>
          <li>
            Questions, or want something removed? Email{" "}
            <a className="font-medium text-forest underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            .
          </li>
        </ul>
      </section>

      <LegalSection title="Who runs this site">
        <p>
          {SITE_NAME} is run by {OWNER}. In this notice, &ldquo;we&rdquo; means {OWNER}. You can
          reach us at{" "}
          <a className="font-medium text-forest underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="What we collect, and why">
        <p>
          <strong>Watching the stream.</strong> The video comes from our own server. When your
          browser requests the page or the video, our servers and our hosting provider
          necessarily receive technical details such as your IP address and browser type. See
          &ldquo;Server logs&rdquo; below. We also show how many people are watching right now;
          that is a live count and nothing about individual viewers is saved for it.
        </p>
        <p>
          <strong>Live chat.</strong> To chat you pick a display name. We store your name, each
          message, the time, and your random browser ID with every message. Anyone in chat can
          see your name and messages, and people who join see the most recent messages. We do not
          store your IP address with your messages. If someone breaks the{" "}
          <Link className="font-medium text-forest underline" href="/terms">
            chat rules
          </Link>
          , we may block a browser ID or an IP address that we enter by hand.
        </p>
        <p>
          <strong>Polls.</strong> When you vote we store which option you chose, the time, and
          your random browser ID, so that each browser gets one vote per poll. We do not ask who
          you are. The same browser ID is attached to your chat messages, so while both exist we
          could tell that they came from the same browser.
        </p>
        <p>
          <strong>Email updates.</strong> If you sign up on the{" "}
          <Link className="font-medium text-forest underline" href="/contact">
            Contact page
          </Link>
          , we collect your email address and the categories you chose. We use it only to send you
          those updates. We do not ask for your name.
        </p>
        <p>
          <strong>Support page notice.</strong> Our{" "}
          <Link className="font-medium text-forest underline" href="/support">
            support page
          </Link>{" "}
          has its own signup, for an email when ways to support the stream become available. We
          collect your email address and the fact that you chose the &ldquo;Support page
          announcements&rdquo; category, nothing else. The address is held in Resend, in a list
          kept separate from our other update lists, and we use it only to tell you about the
          support page. Every email has an unsubscribe link; unsubscribing stops the emails, and
          you can email us to have the address removed completely.
        </p>
        <p id="push-notifications" className="scroll-mt-6">
          <strong>Phone and browser notifications.</strong> If you choose &ldquo;Turn on
          notifications&rdquo; in the &ldquo;Notify me&rdquo; window, your browser creates a push
          subscription for this site. We store that subscription&rsquo;s push address (a web
          address at your browser maker&rsquo;s push service), the two keys that let us send to
          it, the categories you chose, when it was created, when a notification last reached it,
          and a count of failed sends in a row. We don&rsquo;t store your name, email or browser ID
          with it. Your browser only asks for permission when you click the button. To turn
          notifications off, use &ldquo;Turn off&rdquo; in the same window, or block notifications
          for this site in your browser or phone settings.
        </p>
        <p id="captures" className="scroll-mt-6">
          <strong>Photos and clips.</strong> &ldquo;Take photo&rdquo; under the video copies the
          frame you are watching into an image inside your browser and adds our watermark. That
          photo is never uploaded: it goes nowhere unless you download or share it yourself. If
          your browser can&rsquo;t make the photo, our server makes it instead, and it is then
          handled like a clip. When you save a clip, our server cuts the last 30 seconds of the
          stream you were watching and stores the file (only the stream&rsquo;s own video,
          nothing from your device) under a long random link, so only people you give the link
          to can open it. To enforce the limits on how many captures one connection can make, we
          store a scrambled code made from your IP address (a keyed hash; the IP address itself
          is not stored and can&rsquo;t be read back from it) with each capture, along with its
          size and time. Visitor clips and server-made photos are deleted after 24 hours. We may
          pick a capture for the public{" "}
          <Link className="font-medium text-forest underline" href="/gallery">
            gallery
          </Link>{" "}
          or keep it; when we do, the code made from your IP address is removed from it at once,
          and the capture is kept until we remove it. Opening or downloading a capture file is
          not logged by our server.
        </p>
        <p>
          <strong>The contact box.</strong> If you send a suggestion, we store the text of your
          message. We don&rsquo;t ask for your name or email, so only include what you are happy
          for us to read. The message is also emailed to us.
        </p>
        <p>
          <strong>Name ideas (suggestion events).</strong> When we run an event, we store each
          idea you send, which frog it is for, and the time. Ideas are never shown publicly, but
          we may show a name we choose. A simple word filter flags some ideas for a closer look;
          flagged ideas are still saved. We don&rsquo;t ask for your name or email.
        </p>
        <p>
          <strong>Spam protection.</strong> To stop the forms being flooded, we keep a short
          record of your IP address, which form was used (turning notifications on or off, or
          changing them, counts too), and when. Forms also contain a hidden
          field that people never see; automated programs often fill it in, and those submissions
          are quietly dropped.
        </p>
        <p>
          <strong>Server logs.</strong> Our video and chat server records, for each request other
          than video files: your IP address, the time, the address requested, the result, the page
          you came from, and your browser and device description. We use this to keep the service
          running, to spot abuse (much of it is automated scanning), and to block people who break
          the rules. Our server&rsquo;s firewall and login logs also record the addresses of
          blocked or failed connection attempts. Our hosting provider keeps its own request logs.
        </p>
      </LegalSection>

      <LegalSection title="Where it is stored and who else handles it">
        <p>We use these services to run the site. They handle your data on our behalf:</p>
        <LegalList>
          <li>
            <strong>Vercel</strong> hosts the website and its features (polls, forms, the admin
            tools), so it handles page requests.
          </li>
          <li>
            <strong>Supabase</strong> is our database and image storage. Chat, votes, contact
            messages and name ideas live here, as do the records of saved clips (the files
            themselves are on our DigitalOcean server).
          </li>
          <li>
            <strong>Resend</strong> sends our emails and holds the list of people who signed up
            for updates.
          </li>
          <li>
            <strong>DigitalOcean</strong> runs our video and chat server, located in New York,
            USA. Saved clips and server-made photos are stored on it.
          </li>
          <li>
            <strong>Google (Gmail)</strong> receives the contact-box messages and poll results
            that are emailed to us. Poll results contain only totals.
          </li>
          <li>
            <strong>Browser push services</strong> deliver phone and browser notifications if you
            turn them on. Which one depends on your device and browser: Google (Chrome and
            Android), Apple (Safari, iPhone and iPad), Mozilla (Firefox) or Microsoft (Edge). Each
            notification passes through that service, which sees the push address and when we
            send; the text itself is encrypted so only your device can read it.
          </li>
          <li>
            <strong>GoDaddy</strong> is where the site&rsquo;s domain name is registered and its
            address lookups are handled.
          </li>
        </LegalList>
        <p>
          The &ldquo;Support us&rdquo; button is just a link: for now it opens our own support
          page, and once our Ko-fi page is open it will open Ko-fi in a new tab. Nothing from
          Ko-fi is loaded on this site, and Ko-fi only gets involved if you click through to it,
          under its own privacy policy. We do not load third-party scripts, fonts, ads or
          analytics.
        </p>
        <p>
          The one exception is the{" "}
          <Link className="font-medium text-forest underline" href="/gallery">
            gallery
          </Link>
          : some featured clips are posted on YouTube, TikTok or Instagram, and the gallery shows
          them in that service&rsquo;s player. Nothing from those services loads until you press
          play on that clip. Once you do, that service receives your IP address and browser
          details and may set its own cookies, under its own privacy policy. For YouTube we use
          its privacy-enhanced mode (youtube-nocookie.com).
        </p>
        <p>
          These providers store data in their own locations and under their own policies. We
          can&rsquo;t promise how long they keep their own logs.
        </p>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <div className="overflow-x-auto rounded-xl border border-moss bg-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-moss text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2 font-semibold">What</th>
                <th className="px-3 py-2 font-semibold">How long</th>
              </tr>
            </thead>
            <tbody className="align-top">
              <tr className="border-b border-moss">
                <td className="px-3 py-2">Chat messages, with your name and browser ID</td>
                <td className="px-3 py-2">
                  About 30 days, then deleted automatically
                </td>
              </tr>
              <tr className="border-b border-moss">
                <td className="px-3 py-2">Votes</td>
                <td className="px-3 py-2">
                  Kept as part of the poll results. The link to your browser ID is removed about a
                  week after the poll closes.
                </td>
              </tr>
              <tr className="border-b border-moss">
                <td className="px-3 py-2">
                  Email address on the updates lists (including the support-page notice)
                </td>
                <td className="px-3 py-2">
                  Until you ask us to remove it. Unsubscribing stops the emails.
                </td>
              </tr>
              <tr className="border-b border-moss">
                <td className="px-3 py-2">
                  Notification subscription (push address, keys and chosen categories)
                </td>
                <td className="px-3 py-2">
                  Until you turn notifications off, or the subscription expires or stops working
                  (deleted as soon as the push service says it&rsquo;s gone, or after 5 failed
                  sends in a row)
                </td>
              </tr>
              <tr className="border-b border-moss">
                <td className="px-3 py-2">
                  Saved clips and server-made photos, with the code made from your IP address
                </td>
                <td className="px-3 py-2">
                  24 hours, then deleted automatically (checked every hour). If we feature one in
                  the gallery or keep it, the code is removed at once and the file is kept until we
                  remove it. Photos made in your browser are never stored by us.
                </td>
              </tr>
              <tr className="border-b border-moss">
                <td className="px-3 py-2">Contact-box messages</td>
                <td className="px-3 py-2">Until we delete them</td>
              </tr>
              <tr className="border-b border-moss">
                <td className="px-3 py-2">Name ideas</td>
                <td className="px-3 py-2">Until we delete them</td>
              </tr>
              <tr className="border-b border-moss">
                <td className="px-3 py-2">Spam-protection records (IP address)</td>
                <td className="px-3 py-2">Deleted within about a day</td>
              </tr>
              <tr className="border-b border-moss">
                <td className="px-3 py-2">Server access logs</td>
                <td className="px-3 py-2">About a week</td>
              </tr>
              <tr className="border-b border-moss">
                <td className="px-3 py-2">Firewall and login logs (blocked or failed attempts)</td>
                <td className="px-3 py-2">About a month</td>
              </tr>
              <tr>
                <td className="px-3 py-2">Browser ID and chat name in your browser</td>
                <td className="px-3 py-2">Until you clear your browser&rsquo;s site data</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          If we need to look into abuse or a problem, we may keep the relevant records longer than
          this while we do.
        </p>
      </LegalSection>

      <LegalSection title="Browser storage and cookies">
        <p>Visitors don&rsquo;t get any cookies from this site. We do use two items in your browser&rsquo;s local storage:</p>
        <LegalList>
          <li>
            <strong>A random browser ID.</strong> It is created the first time you open the site.
            It lets us give each browser one vote per poll, tell chat users apart, and apply bans.
            It is sent to our site with polls and chat.
          </li>
          <li>
            <strong>Your chat name.</strong> Saved only if you join chat, so you don&rsquo;t have
            to type it again.
          </li>
        </LegalList>
        <p>
          If you turn on notifications, your browser also keeps this site&rsquo;s small
          notification helper (a &ldquo;service worker&rdquo;, used only to show notifications; it
          doesn&rsquo;t store pages or data) and the push subscription. Turning notifications off
          removes the subscription.
        </p>
        <p>
          Nothing else is stored. (The site&rsquo;s administrator, and only the administrator,
          gets a login cookie after signing in.) You can clear this any time in your browser
          settings; the next visit will create a new random ID.
        </p>
      </LegalSection>

      <LegalSection title="Your choices">
        <LegalList>
          <li>You can watch without chatting, voting, or signing up for anything.</li>
          <li>
            Every update email has an unsubscribe link. To have your address removed completely,
            email us.
          </li>
          <li>
            Phone and browser notifications are off unless you turn them on. Turn them off with
            &ldquo;Turn off&rdquo; in the &ldquo;Notify me&rdquo; window (we delete the
            subscription at once), or in your browser or phone settings (we delete it the next
            time a send to it fails).
          </li>
          <li>
            You can ask us to delete your chat messages. Tell us your chat name and roughly when
            you wrote them so we can find them.
          </li>
          <li>
            You can ask us to delete a contact-box message or a name idea if you tell us what it
            said.
          </li>
          <li>
            You can ask us to delete a clip you saved before its 24 hours are up, or to take a
            capture out of the gallery. Send us its link.
          </li>
          <li>
            Once a vote has been unlinked from its browser ID, we can no longer tell which vote was
            yours, so we can&rsquo;t remove it individually.
          </li>
          <li>
            You can ask what we hold about you. We&rsquo;ll do our best to find and share it,
            within the limits of what we can identify.
          </li>
        </LegalList>
        <p>
          Email{" "}
          <a className="font-medium text-forest underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>{" "}
          for any of this.
        </p>
      </LegalSection>

      <LegalSection title="Children">
        <p>
          The site is for a general audience. Chat is intended for people aged 13 and older. We
          don&rsquo;t knowingly collect personal information from children under 13. If you think
          a child under 13 has used chat or sent us their email address, please contact us and we
          will delete it.
        </p>
      </LegalSection>

      <LegalSection title="Changes to this notice">
        <p>
          If we change how the site handles data, we&rsquo;ll update this page and its
          &ldquo;last updated&rdquo; date. See also our{" "}
          <Link className="font-medium text-forest underline" href="/terms">
            terms
          </Link>
          .
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
