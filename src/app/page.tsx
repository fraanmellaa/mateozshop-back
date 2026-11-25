import { SiteHeader } from "./components/Header";
import { requireAdminPage } from "@/app/utils/auth";

export default async function MainPage() {
  await requireAdminPage();
  return (
    <div className="p-6">
      <SiteHeader title="Inicio" />
    </div>
  );
}
