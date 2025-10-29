"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface SendWinnerEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSend: (subject: string, message: string) => void;
  winnerEmail: string;
  winnerName: string;
  giveawayTitle: string;
}

export default function SendWinnerEmailModal({
  isOpen,
  onClose,
  onSend,
  winnerEmail,
  winnerName,
  giveawayTitle,
}: SendWinnerEmailModalProps) {
  const [subject, setSubject] = useState(
    `¡Felicidades! Has ganado: ${giveawayTitle}`
  );
  const [message, setMessage] = useState(
    `¡Hola ${winnerName}!\n\n¡Felicidades! Has sido seleccionado como ganador de nuestro sorteo "${giveawayTitle}".\n\nNuestro equipo se pondrá en contacto contigo pronto para coordinar la entrega del premio.\n\n¡Gracias por participar!\n\n— El equipo de MateozShop`
  );
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;

    setIsLoading(true);
    try {
      await onSend(subject.trim(), message.trim());
      handleClose();
    } catch (error) {
      console.error("Error sending email:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    onClose();
    // Reset form cuando se cierra
    setSubject(`¡Felicidades! Has ganado: ${giveawayTitle}`);
    setMessage(
      `¡Hola ${winnerName}!\n\n¡Felicidades! Has sido seleccionado como ganador de nuestro sorteo "${giveawayTitle}".\n\nNuestro equipo se pondrá en contacto contigo pronto para coordinar la entrega del premio.\n\n¡Gracias por participar!\n\n— El equipo de MateozShop`
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Enviar email al ganador</DialogTitle>
            <DialogDescription>
              Enviando email a: <strong>{winnerEmail}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="subject">Asunto</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Asunto del email"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="message">Mensaje</Label>
              <Textarea
                id="message"
                value={message}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setMessage(e.target.value)
                }
                placeholder="Mensaje del email"
                rows={8}
                disabled={isLoading}
                className="resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isLoading}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !subject.trim() || !message.trim()}
            >
              {isLoading ? "Enviando..." : "Enviar email"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
