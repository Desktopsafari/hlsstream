import SubscribeForm from "@/components/contact/SubscribeForm";
import SuggestionForm from "@/components/contact/SuggestionForm";
import { SITE_NAME } from "@/config/constants";

export const metadata = {
  title: `Contact — ${SITE_NAME}`,
};

export default function ContactPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold text-forest sm:text-3xl">Contact</h1>
        <p className="text-sm text-muted">Sign up for updates or send us a suggestion.</p>
      </div>

      <SubscribeForm />
      <SuggestionForm />
    </div>
  );
}
