import { getUserById } from "@/app/utils/users";
import { SiteHeader } from "@/app/components/Header";
import { notFound } from "next/navigation";
import UserDetail from "@/app/users/[id]/UserDetail";

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = await params;
  const id = resolvedParams.id;

  if (isNaN(parseInt(id))) {
    notFound();
  }

  const user = await getUserById(parseInt(id));

  if (!user) {
    notFound();
  }

  return (
    <div className="p-6">
      <SiteHeader title={`Usuario: ${user.username}`} />
      <UserDetail user={user} />
    </div>
  );
}
