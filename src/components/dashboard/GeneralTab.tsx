import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, supabaseConfig } from "@/integrations/supabase/client";
import MetricCard from "./MetricCard";
import {
  FileText,
  Headphones,
  UserCheck,
  PackageX,
  Wrench,
  Search,
  CheckCircle,
  CalendarIcon,
  AlertCircle,
  CreditCard,
  Banknote,
  UserX,
  PhoneOff,
  Handshake
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import LoadingState from "@/components/ui/loading-state";
import { MessageSquare } from "lucide-react";

const GeneralTab = () => {
  // No date filters needed for chatwoot-labels-current

  // Fetch Chatwoot labels (current totals, no date filter)
  const { data: chatwootData, isLoading: loadingChatwoot, error } = useQuery({
    queryKey: ["chatwoot-labels-current"],
    queryFn: async () => {
      console.log("🚀 Iniciando carga de etiquetas actuales de Chatwoot (sin filtro de fecha)");

      // URL de la nueva Edge Function
      const functionUrl = `${supabaseConfig.supabaseUrl}/functions/v1/chatwoot-labels-current`;

      // Inicializar variables de paginación
      let pageFrom = 1;
      let pageTo = 10;
      let isDone = false;
      const accumulatedCounts: Record<string, number> = {};
      let totalPagesProcessed = 0;
      let totalConversations = 0;
      let allCount = 0;

      // Loop de paginación hasta que done === true
      while (!isDone) {
        totalPagesProcessed++;

        console.log(`📄 Solicitando páginas ${pageFrom} a ${pageTo}...`);

        const response = await fetch(functionUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseConfig.supabaseKey}`,
          },
          body: JSON.stringify({
            status: "all",
            perPage: 25,
            pageFrom,
            pageTo,
            maxPagesPerCall: 10
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error("❌ Error HTTP:", response.status, errorText);
          throw new Error(`Error HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();

        console.log(`✅ Chunk ${totalPagesProcessed} recibido:`, {
          pages: `${pageFrom}-${pageTo}`,
          conversaciones: data.total_conversaciones_leidas_en_este_chunk,
          done: data.done,
          next: data.next_page_from ? `${data.next_page_from}-${data.next_page_to}` : 'N/A'
        });

        // Guardar all_count del primer chunk
        if (totalPagesProcessed === 1 && data.meta_all_count) {
          allCount = data.meta_all_count;
          console.log(`📊 Total de conversaciones (all_count): ${allCount}`);
        }

        // Acumular conteos de etiquetas
        if (data.counts_by_label_name) {
          for (const [label, count] of Object.entries(data.counts_by_label_name)) {
            accumulatedCounts[label] = (accumulatedCounts[label] || 0) + (count as number);
          }
        }

        totalConversations += data.total_conversaciones_leidas_en_este_chunk || 0;

        // Verificar si está completo
        if (data.done === true) {
          isDone = true;
          console.log(`🎯 Carga completa! Total de chunks procesados: ${totalPagesProcessed}`);
          console.log(`📊 Total de conversaciones procesadas: ${totalConversations}`);
        } else if (data.next_page_from !== null && data.next_page_from !== undefined) {
          pageFrom = data.next_page_from;
          pageTo = data.next_page_to;
        } else {
          // Fallback: si no hay done ni next_page_from, terminar
          isDone = true;
          console.log(`⚠️ Terminando: no hay done=true ni next_page_from`);
        }
      }

      console.log("✅ Etiquetas finales acumuladas:", accumulatedCounts);
      return {
        labels: accumulatedCounts,
        totalConversations: allCount || totalConversations
      };
    },
    retry: 2,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000, // 5 minutos
  });

  if (loadingChatwoot) {
    return (
      <LoadingState
        title="Cargando métricas de Chatwoot..."
        message="Procesando conversaciones por bloques. Esto puede tardar varios segundos dependiendo del rango de fechas seleccionado. Por favor espere..."
        skeletonCount={9}
      />
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold mb-2">Métricas Generales</h2>
          <p className="text-muted-foreground mb-4">Vista general de campañas y conversaciones</p>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Error al cargar las métricas de Chatwoot: {error?.message || 'Error desconocido'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (<div className="space-y-6">
    <div>
      <h2 className="text-2xl font-bold mb-2">Métricas Generales</h2>
      <p className="text-muted-foreground mb-4">
        Vista general de etiquetas actuales en Chatwoot (sin filtro de fecha)
      </p>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <MetricCard
        title="TOTAL CONVERSACIONES"
        value={loadingChatwoot ? "..." : (chatwootData?.totalConversations?.toString() || "0")}
        icon={MessageSquare}
        description="Total de conversaciones en Chatwoot"
        variant="default"
        className="bg-primary/10 border-primary/20"
      />
      <MetricCard
        title="Comprobantes Enviados"
        value={chatwootData?.labels?.comprobante_enviado?.toString() || "0"}
        icon={FileText}
        description="Cliente mandó el comprobante de pago"
        variant="primary"
      />
      <MetricCard
        title="Facturas Enviadas"
        value={chatwootData?.labels?.factura_enviada?.toString() || "0"}
        icon={FileText}
        description="Cliente indicó que ya pagó y mandó factura de pago"
        variant="primary"
      />
      <MetricCard
        title="Consultas Saldo"
        value={chatwootData?.labels?.consulto_saldo?.toString() || "0"}
        icon={Search}
        description="Cliente realizó consulta de sus créditos para saber qué valores tiene pendientes"
        variant="primary"
      />
      <MetricCard
        title="Pagado"
        value={chatwootData?.labels?.pagado?.toString() || "0"}
        icon={CreditCard}
        description="Se da a conocer que cliente ya había pagado y no tiene nada pendiente por pagar"
        variant="success"
      />
      <MetricCard
        title="Soporte"
        value={chatwootData?.labels?.soporte?.toString() || "0"}
        icon={Headphones}
        description="Usuario pidió contacto humano directo - que quiere hablar con alguien explícitamente"
        variant="warning"
      />
      <MetricCard
        title="Cobrador"
        value={chatwootData?.labels?.cobrador?.toString() || "0"}
        icon={UserCheck}
        description="Cliente solicita que se le envíe un cobrador"
        variant="warning"
      />
      <MetricCard
        title="Devolución Producto"
        value={chatwootData?.labels?.devolucion_producto?.toString() || "0"}
        icon={PackageX}
        description="Cliente solicita devolver el producto adquirido"
        variant="destructive"
      />
      <MetricCard
        title="Servicio Técnico"
        value={chatwootData?.labels?.servicio_tecnico?.toString() || "0"}
        icon={Wrench}
        description="Cliente desea hablar con soporte técnico"
        variant="warning"
      />
      <MetricCard
        title="Consulta Datos Transferencia"
        value={chatwootData?.labels?.consulto_datos_transferencia?.toString() || "0"}
        icon={Banknote}
        description="Cliente solicita datos de cuentas bancarias"
        variant="primary"
      />
      <MetricCard
        title="No Registrado"
        value={chatwootData?.labels?.no_registrado?.toString() || "0"}
        icon={UserX}
        description="Cliente no encontrado en base de datos de POINT"
        variant="destructive"
      />
      <MetricCard
        title="Casos Resueltos"
        value={chatwootData?.labels?.resuelto?.toString() || "0"}
        icon={CheckCircle}
        description="Casos resueltos de soporte, servicio técnico, devolución producto y cobrador"
        variant="success"
      />
      <MetricCard
        title="Número Equivocado"
        value={chatwootData?.labels?.numero_equivocado?.toString() || "0"}
        icon={PhoneOff}
        description="Cliente indicó que fue contactado por error"
        variant="destructive"
      />
      <MetricCard
        title="Compromiso Pago"
        value={chatwootData?.labels?.compromiso_pago?.toString() || "0"}
        icon={Handshake}
        description="Cliente se ha comprometido a realizar el pago"
        variant="success"
      />
      <MetricCard
        title="Documento Enviado"
        value={chatwootData?.labels?.documento_enviado?.toString() || "0"}
        icon={FileText}
        description="Cliente envió un documento (no necesariamente comprobante)"
        variant="primary"
      />
      <MetricCard
        title="Faltan Datos"
        value={chatwootData?.labels?.faltan_datos?.toString() || "0"}
        icon={AlertCircle}
        description="No se reconocen bien los datos del comprobante enviado"
        variant="warning"
      />
      <MetricCard
        title="Imagen Enviada"
        value={chatwootData?.labels?.imagen_enviada?.toString() || "0"}
        icon={FileText}
        description="Cliente envió una imagen"
        variant="primary"
      />
      <MetricCard
        title="Pago Parcial"
        value={chatwootData?.labels?.pago_parcial?.toString() || "0"}
        icon={Banknote}
        description="Todavía tiene monto pendiente por pagar"
        variant="warning"
      />
      <MetricCard
        title="Quiero Pagar"
        value={chatwootData?.labels?.quiero_pagar?.toString() || "0"}
        icon={Handshake}
        description="Cliente quiere hacer gestión de pago"
        variant="success"
      />
      <MetricCard
        title="Reactivación Cobro"
        value={chatwootData?.labels?.reactivacion_cobro?.toString() || "0"}
        icon={UserCheck}
        description="Gestión de reactivación de cobro"
        variant="default"
      />
      <MetricCard
        title="Recordatorio"
        value={chatwootData?.labels?.recordatorio?.toString() || "0"}
        icon={CalendarIcon}
        description="Recordatorio general"
        variant="default"
      />
      <MetricCard
        title="Recordatorio Compromiso"
        value={chatwootData?.labels?.recordatorio_compromiso_pago?.toString() || "0"}
        icon={CalendarIcon}
        description="Recordatorio de compromiso de pago"
        variant="warning"
      />
      <MetricCard
        title="Mora 1 Día"
        value={chatwootData?.labels?.recordatorio_diasmora_1?.toString() || "0"}
        icon={AlertCircle}
        description="Recordatorio de 1 día de mora"
        variant="destructive"
      />
      <MetricCard
        title="Mora < 3 Días"
        value={chatwootData?.labels?.recordatorio_diasmora_menos_3?.toString() || "0"}
        icon={AlertCircle}
        description="Recordatorio de menos de 3 días de mora"
        variant="destructive"
      />
    </div>
  </div>
  );
};

export default GeneralTab;
