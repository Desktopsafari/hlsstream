import { redirect } from "next/navigation";
import SubscribeForm from "@/components/contact/SubscribeForm";
import {
  KOFI_URL,
  SITE_NAME,
  SUPPORT_CATEGORY_NAME,
  SUPPORT_PAGE_LIVE,
} from "@/config/constants";

export const metadata = {
  title: `Support us — ${SITE_NAME}`,
};

export default function SupportPage() {
  // Once the Ko-fi page is open, old /support links just forward there.
  if (SUPPORT_PAGE_LIVE) redirect(KOFI_URL);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold text-forest sm:text-3xl">
          Ways to support coming soon!
        </h1>
        <p className="text-sm text-muted">
          Our Ko-fi page isn&rsquo;t open yet. Sign up below and we&rsquo;ll email you when the
          support page goes live.
        </p>
      </div>

      <SubscribeForm
        onlyCategory={SUPPORT_CATEGORY_NAME}
        intro="Get an email when the support page goes live. Unsubscribe anytime via the link in any email you receive."
        successMessage="You're signed up! We'll email you when the support page goes live."
      />
    </div>
  );
}
