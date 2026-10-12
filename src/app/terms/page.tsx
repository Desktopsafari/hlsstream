import Link from "next/link";
import { LegalLayout, LegalList, LegalSection } from "@/components/legal/LegalLayout";
import { SITE_NAME } from "@/config/constants";

export const metadata = {
  title: `Terms — ${SITE_NAME}`,
};

const LAST_UPDATED = "October 12, 2026";
const OWNER = "DesktopSafari";
const CONTACT_EMAIL = "desktopsafari@gmail.com";

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of use" updated={LAST_UPDATED}>
      <LegalSection title="Using the site">
        <p>
          {SITE_NAME} is a live stream of our frogs with a chat, daily polls, and a few ways to
          get in touch, run by {OWNER}. By using the site you agree to these terms. If you
          don&rsquo;t agree, please don&rsquo;t use the chat, polls, or forms. You&rsquo;re
          welcome to just watch.
        </p>
      </LegalSection>

      <LegalSection title="Chat rules">
        <p>
          Chat is for friendly conversation about the stream. Chat is intended for people aged 13
          and older. Please:
        </p>
        <LegalList>
          <li>Be kind. No harassment, bullying, threats, hate speech, or personal attacks.</li>
          <li>No spam, advertising, repeated messages, or links to unrelated sites.</li>
          <li>
            Don&rsquo;t share your own or anyone else&rsquo;s private information (real names,
            addresses, phone numbers, passwords).
          </li>
          <li>Nothing illegal, sexual, or graphic, and no pretending to be someone else.</li>
          <li>Don&rsquo;t try to get around the filters, rate limits, or bans.</li>
        </LegalList>
        <p>
          Everything you write in chat is visible to everyone in chat. Think before you post, and
          see our{" "}
          <Link className="font-medium text-forest underline" href="/privacy">
            privacy notice
          </Link>{" "}
          for how chat data is handled.
        </p>
      </LegalSection>

      <LegalSection title="Moderation">
        <p>
          We can remove any message, and block anyone from chat, at our discretion, with or
          without warning. A block may apply to a browser or to an IP address. Messages may also
          be removed or lost for technical reasons, and chat messages are deleted automatically
          after about 30 days. We don&rsquo;t have to give a reason, and we&rsquo;ll try to be
          fair. If you think a block was a mistake, email{" "}
          <a className="font-medium text-forest underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="Suggestions and other things you send us">
        <p>
          When you send a suggestion, a name idea, or a message through the site, you&rsquo;re
          giving us permission to read it and use it to run and improve the site, including
          choosing a name you suggested and showing it publicly. We&rsquo;re not obliged to use,
          reply to, or credit any suggestion. Only send what you&rsquo;re happy for us to use.
        </p>
      </LegalSection>

      <LegalSection title="The stream and the site">
        <p>
          We do our best to keep the stream running, but it can go offline, drop, or lag without
          notice, and polls, chat and other features may change or stop at any time. The site is
          provided as it is, without promises that it will always be available or error-free.
          Links to other sites, such as Ko-fi, take you to services we don&rsquo;t control.
        </p>
      </LegalSection>

      <LegalSection title="Changes and contact">
        <p>
          We may update these terms; the date at the top shows when they last changed, and
          continuing to use the site means you accept the updated terms. Questions? Email{" "}
          <a className="font-medium text-forest underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
