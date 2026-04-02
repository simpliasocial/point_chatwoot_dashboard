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

  // Query global cache (very fast)
  const { data: globalCache } = useQuery({
    queryKey: ["dashboard-cache", "chatwoot-labels-current"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dashboard_cache" as any)
        .select("data")
        .eq("key", "chatwoot-labels-current")
        .maybeSingle();

      if (error) return null;
      return (data as any)?.data || null;
    },
    staleTime: Infinity, // Solo sirve como fallback inicial The query below brings the real data
  });

  // Fetch Chatwoot labels (current totals, no date filter)
  const { data: chatwootData, isLoading: loadingChatwoot, isFetching, error } = useQuery({
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
      const result = {
        labels: accumulatedCounts,
        totalConversations: allCount || totalConversations
      };

      try {
        await supabase.from("dashboard_cache" as any).upsert({
          key: "chatwoot-labels-current",
          data: result,
          updated_at: new Date().toISOString()
        });
      } catch (e) {
        console.error("No se pudo guardar en caché global", e);
      }

      return result;
    },
    retry: 2,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000, // 5 minutos
  });

  const displayData = chatwootData || globalCache;
  const isInitialLoading = loadingChatwoot && !displayData;
  const isBackgroundUpdating = isFetching && !!displayData;

  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const [selectedLabelTitle, setSelectedLabelTitle] = useState<string | null>(null);

  const handleMetricClick = (id: string, title: string) => {
    if (id === 'all') return; // Do not filter for total conversations
    setSelectedLabelId(id);
    setSelectedLabelTitle(title);
  };


  if (isInitialLoading) {
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
    <div className="flex justify-between items-start">
      <div>
        <h2 className="text-2xl font-bold mb-2">Métricas Generales</h2>
        <p className="text-muted-foreground mb-4">
          Vista general de etiquetas actuales en Chatwoot (sin filtro de fecha)
        </p>
      </div>
      {isBackgroundUpdating && (
        <Alert className="w-auto bg-blue-50 text-blue-800 border-blue-200 py-2">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
            </span>
            <AlertDescription className="font-medium text-sm">
              Se están actualizando los datos...
            </AlertDescription>
          </div>
        </Alert>
      )}
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <MetricCard
        title="TOTAL CONVERSACIONES"
        value={loadingChatwoot && !displayData ? "..." : (displayData?.totalConversations?.toString() || "0")}
        icon={MessageSquare}
        description="Total de conversaciones en Chatwoot"
        variant="default"
        className="bg-primary/10 border-primary/20"
      />
      <MetricCard
        title="Comprobantes Enviados"
        value={displayData?.labels?.comprobante_enviado?.toString() || "0"}
        icon={FileText}
        description="Cliente mandó el comprobante de pago"
        variant="primary"
        onClick={() => handleMetricClick("comprobante_enviado", "Comprobantes Enviados")}
      />
      <MetricCard
        title="Facturas Enviadas"
        value={displayData?.labels?.factura_enviada?.toString() || "0"}
        icon={FileText}
        description="Cliente indicó que ya pagó y mandó factura de pago"
        variant="primary"
        onClick={() => handleMetricClick("factura_enviada", "Facturas Enviadas")}
      />
      <MetricCard
        title="Consultas Saldo"
        value={displayData?.labels?.consulto_saldo?.toString() || "0"}
        icon={Search}
        description="Cliente realizó consulta de sus créditos para saber qué valores tiene pendientes"
        variant="primary"
        onClick={() => handleMetricClick("consulto_saldo", "Consultas Saldo")}
      />
      <MetricCard
        title="Pagado"
        value={displayData?.labels?.pagado?.toString() || "0"}
        icon={CreditCard}
        description="Se da a conocer que cliente ya había pagado y no tiene nada pendiente por pagar"
        variant="success"
        onClick={() => handleMetricClick("pagado", "Pagado")}
      />
      <MetricCard
        title="Soporte"
        value={displayData?.labels?.soporte?.toString() || "0"}
        icon={Headphones}
        description="Usuario pidió contacto humano directo - que quiere hablar con alguien explícitamente"
        variant="warning"
        onClick={() => handleMetricClick("soporte", "Soporte")}
      />
      <MetricCard
        title="Cobrador"
        value={displayData?.labels?.cobrador?.toString() || "0"}
        icon={UserCheck}
        description="Cliente solicita que se le envíe un cobrador"
        variant="warning"
        onClick={() => handleMetricClick("cobrador", "Cobrador")}
      />
      <MetricCard
        title="Devolución Producto"
        value={displayData?.labels?.devolucion_producto?.toString() || "0"}
        icon={PackageX}
        description="Cliente solicita devolver el producto adquirido"
        variant="destructive"
        onClick={() => handleMetricClick("devolucion_producto", "Devolución Producto")}
      />
      <MetricCard
        title="Servicio Técnico"
        value={displayData?.labels?.servicio_tecnico?.toString() || "0"}
        icon={Wrench}
        description="Cliente desea hablar con soporte técnico"
        variant="warning"
        onClick={() => handleMetricClick("servicio_tecnico", "Servicio Técnico")}
      />
      <MetricCard
        title="Consulta Datos Transferencia"
        value={displayData?.labels?.consulto_datos_transferencia?.toString() || "0"}
        icon={Banknote}
        description="Cliente solicita datos de cuentas bancarias"
        variant="primary"
        onClick={() => handleMetricClick("consulto_datos_transferencia", "Consulta Datos Transferencia")}
      />
      <MetricCard
        title="No Registrado"
        value={displayData?.labels?.no_registrado?.toString() || "0"}
        icon={UserX}
        description="Cliente no encontrado en base de datos de POINT"
        variant="destructive"
        onClick={() => handleMetricClick("no_registrado", "No Registrado")}
      />
      <MetricCard
        title="Casos Resueltos"
        value={displayData?.labels?.resuelto?.toString() || "0"}
        icon={CheckCircle}
        description="Casos resueltos de soporte, servicio técnico, devolución producto y cobrador"
        variant="success"
        onClick={() => handleMetricClick("resuelto", "Casos Resueltos")}
      />
      <MetricCard
        title="Número Equivocado"
        value={displayData?.labels?.numero_equivocado?.toString() || "0"}
        icon={PhoneOff}
        description="Cliente indicó que fue contactado por error"
        variant="destructive"
        onClick={() => handleMetricClick("numero_equivocado", "Número Equivocado")}
      />
      <MetricCard
        title="Compromiso Pago"
        value={displayData?.labels?.compromiso_pago?.toString() || "0"}
        icon={Handshake}
        description="Cliente se ha comprometido a realizar el pago"
        variant="success"
        onClick={() => handleMetricClick("compromiso_pago", "Compromiso Pago")}
      />
      <MetricCard
        title="Documento Enviado"
        value={displayData?.labels?.documento_enviado?.toString() || "0"}
        icon={FileText}
        description="Cliente envió un documento (no necesariamente comprobante)"
        variant="primary"
        onClick={() => handleMetricClick("documento_enviado", "Documento Enviado")}
      />
      <MetricCard
        title="Faltan Datos"
        value={displayData?.labels?.faltan_datos?.toString() || "0"}
        icon={AlertCircle}
        description="No se reconocen bien los datos del comprobante enviado"
        variant="warning"
        onClick={() => handleMetricClick("faltan_datos", "Faltan Datos")}
      />
      <MetricCard
        title="Imagen Enviada"
        value={displayData?.labels?.imagen_enviada?.toString() || "0"}
        icon={FileText}
        description="Cliente envió una imagen"
        variant="primary"
        onClick={() => handleMetricClick("imagen_enviada", "Imagen Enviada")}
      />
      <MetricCard
        title="Pago Parcial"
        value={displayData?.labels?.pago_parcial?.toString() || "0"}
        icon={Banknote}
        description="Todavía tiene monto pendiente por pagar"
        variant="warning"
        onClick={() => handleMetricClick("pago_parcial", "Pago Parcial")}
      />
      <MetricCard
        title="Quiero Pagar"
        value={displayData?.labels?.quiero_pagar?.toString() || "0"}
        icon={Handshake}
        description="Cliente quiere hacer gestión de pago"
        variant="success"
        onClick={() => handleMetricClick("quiero_pagar", "Quiero Pagar")}
      />
      <MetricCard
        title="Reactivación Cobro"
        value={displayData?.labels?.reactivacion_cobro?.toString() || "0"}
        icon={UserCheck}
        description="Gestión de reactivación de cobro"
        variant="default"
        onClick={() => handleMetricClick("reactivacion_cobro", "Reactivación Cobro")}
      />
      <MetricCard
        title="Recordatorio"
        value={displayData?.labels?.recordatorio?.toString() || "0"}
        icon={CalendarIcon}
        description="Recordatorio general"
        variant="default"
        onClick={() => handleMetricClick("recordatorio", "Recordatorio")}
      />
      <MetricCard
        title="Recordatorio Compromiso"
        value={displayData?.labels?.recordatorio_compromiso_pago?.toString() || "0"}
        icon={CalendarIcon}
        description="Recordatorio de compromiso de pago"
        variant="warning"
        onClick={() => handleMetricClick("recordatorio_compromiso_pago", "Recordatorio Compromiso")}
      />
      <MetricCard
        title="Mora 1 Día"
        value={displayData?.labels?.recordatorio_diasmora_1?.toString() || "0"}
        icon={AlertCircle}
        description="Recordatorio de 1 día de mora"
        variant="destructive"
        onClick={() => handleMetricClick("recordatorio_diasmora_1", "Mora 1 Día")}
      />
      <MetricCard
        title="Mora < 3 Días"
        value={displayData?.labels?.recordatorio_diasmora_menos_3?.toString() || "0"}
        icon={AlertCircle}
        description="Recordatorio de menos de 3 días de mora"
        variant="destructive"
        onClick={() => handleMetricClick("recordatorio_diasmora_menos_3", "Mora < 3 Días")}
      />
    </div>

  </div>
  );
};

export default GeneralTab;
