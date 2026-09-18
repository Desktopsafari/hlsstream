import type { Metadata } from "next";
import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLoginPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <LoginForm />
    </div>
  );
}
