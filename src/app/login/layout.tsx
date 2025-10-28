import { Toaster } from "sonner";

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      {children}
      <Toaster position="top-right" theme="dark" />
    </div>
  );
}
