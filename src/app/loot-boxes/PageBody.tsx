"use client";

import { useState } from "react";

import type { AdminBox } from "@/app/utils/lootBoxes/types";

import BoxesTab from "./BoxesTab";
import DeliveriesTab from "./DeliveriesTab";

type Tab = "boxes" | "deliveries";

export default function PageBody({ boxes }: { boxes: AdminBox[] }) {
  const [tab, setTab] = useState<Tab>("boxes");

  const tabClass = (active: boolean) =>
    `px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
      active
        ? "border-primary text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="mt-4">
      <div className="flex gap-2 border-b">
        <button type="button" className={tabClass(tab === "boxes")} onClick={() => setTab("boxes")}>
          Cajas
        </button>
        <button
          type="button"
          className={tabClass(tab === "deliveries")}
          onClick={() => setTab("deliveries")}
        >
          Entregas
        </button>
      </div>

      <div className="mt-4">
        {tab === "boxes" ? <BoxesTab boxes={boxes} /> : <DeliveriesTab />}
      </div>
    </div>
  );
}
