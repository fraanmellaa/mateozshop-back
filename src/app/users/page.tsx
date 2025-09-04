import { SiteHeader } from "../components/Header";
import { getUsers } from "../utils/users";

import PageBody from "./PageBody";

export default async function ProductsPage() {
  const users = await getUsers();

  return (
    <div className="p-6">
      <SiteHeader title="Usuarios Registrados" />
      <PageBody users={users} />
    </div>
  );
}
