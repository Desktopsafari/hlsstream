import Link from "next/link";
import { LegalLayout, LegalList, LegalSection } from "@/components/legal/LegalLayout";
import { SITE_NAME } from "@/config/constants";

export const metadata = {
  title: `Privacy notice — ${SITE_NAME}`,
};

// Keep this page accurate: any change that collects, stores, shares, or keeps
// visitor data differently must update it in the same change (see AGENTS.md).
const LAST_UPDATED = "October 12, 2026";
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
            Your email address is only used if you sign up for updates, and every update has an
            unsubscribe link.
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
          record of your IP address, which form was used, and when. Forms also contain a hidden
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
            messages and name ideas live here.
          </li>
          <li>
            <strong>Resend</strong> sends our emails and holds the list of people who signed up
            for updates.
          </li>
          <li>
            <strong>DigitalOcean</strong> runs our video and chat server, located in New York,
            USA.
          </li>
          <li>
            <strong>Google (Gmail)</strong> receives the contact-box messages and poll results
            that are emailed to us. Poll results contain only totals.
          </li>
          <li>
            <strong>GoDaddy</strong> is where the site&rsquo;s domain name is registered and its
            address lookups are handled.
          </li>
        </LegalList>
        <p>
          The Ko-fi button is just a link. Nothing from Ko-fi is loaded on this site, and Ko-fi
          only gets involved if you click it, under its own privacy policy. We do not load
          third-party scripts, fonts, ads or analytics.
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
                <td className="px-3 py-2">Email address on the updates list</td>
                <td className="px-3 py-2">
                  Until you ask us to remove it. Unsubscribing stops the emails.
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
            You can ask us to delete your chat messages. Tell us your chat name and roughly when
            you wrote them so we can find them.
          </li>
          <li>
            You can ask us to delete a contact-box message or a name idea if you tell us what it
            said.
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
