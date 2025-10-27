import { getOrderById } from "@/app/utils/orders";
import { SiteHeader } from "@/app/components/Header";
import { notFound } from "next/navigation";
import OrderDetail from "./OrderDetail";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = await params;
  const id = resolvedParams.id;

  if (isNaN(parseInt(id))) {
    notFound();
  }

  const order = await getOrderById(parseInt(id));

  if (!order) {
    notFound();
  }

  return (
    <div className="p-6">
      <SiteHeader title={`Pedido #${order.id}`} />
      <OrderDetail order={order} />
    </div>
  );
}
