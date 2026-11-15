import { Suspense } from "react";
import { SiteHeader } from "../components/Header";
import { getOrders } from "../utils/orders";
import PageBody from "@/app/orders/PageBody";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const orders = await getOrders();

  return (
    <div className="p-6">
      <SiteHeader title="Gestión de Pedidos" />
      <Suspense fallback={<div>Cargando pedidos...</div>}>
        <PageBody allOrders={orders} />
      </Suspense>
    </div>
  );
}
