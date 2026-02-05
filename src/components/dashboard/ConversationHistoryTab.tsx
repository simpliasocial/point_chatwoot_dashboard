import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, User, Phone, CreditCard, MessageCircle, Package, Bot, AlertCircle, Filter, CheckCircle, Users, MessageSquare } from "lucide-react";
import MetricCard from "./MetricCard";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import LoadingState from "@/components/ui/loading-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface ConversationRecord {
  idCompra: number;
  Cliente: string;
  Cedula: number;
  Celular: number;
  conversation_id: number;
  Segmento?: string;
  Status?: string;
  Articulo?: string;
  ComprobanteEnviado?: string;
  SaldoVencido?: number;
  DiceQueYaPago?: string;
  LlamarOtraVez?: string;
  compromiso_pago_fecha?: string;
  TipoDePago?: string;
  RestanteSaldoVencido?: number;
  EstadoEtiqueta?: string;
}

interface PriorityResult {
  prioridad: number;
  prioridad_porque: string;
  confianza: number;
}

interface ConversationMessage {
  id: number;
  conversation_id: number;
  fecha_iso: string;
  rol: "BOT" | "CLIENTE" | "DESCONOCIDO" | string;
  privado: boolean;
  estado: string;
  tipo: string;
  texto: string;
}

interface ConversationHistory {
  conversation_id: number;
  total: number;
  transcript?: string;
  mensajes: ConversationMessage[];
}

const N8N_WEBHOOK_URL = import.meta.env.VITE_N8N_CONVERSATION_WEBHOOK_URL ||
  "https://primary-production-f05b.up.railway.app/webhook/651db7d0-7d3e-42a8-82b0-133c08a78201";

// Función para calcular la prioridad de una conversación
const calculatePriority = (record: ConversationRecord): PriorityResult => {
  const saldoVencido = record.SaldoVencido || 0;
  const comprobanteEnviado = record.ComprobanteEnviado?.toUpperCase() === "SI";
  const diceQueYaPago = record.DiceQueYaPago?.toUpperCase() === "SI";
  const llamarOtraVez = record.LlamarOtraVez?.toUpperCase() === "SI";
  const tieneCompromiso = !!record.compromiso_pago_fecha;
  const tipoDePago = record.TipoDePago?.toLowerCase();
  const restanteSaldo = record.RestanteSaldoVencido || 0;
  const estadoEtiqueta = record.EstadoEtiqueta?.toLowerCase() || "";

  // Etiquetas de casos cerrados o no relacionados a cobranza
  const etiquetasCerradas = ["servicio_tecnico", "soporte", "numero_equivocado", "no_registrado"];
  const etiquetasEvasivas = ["consulto_saldo", "consulto_datos_transferencia"];
  const etiquetasPositivas = ["compromiso_pago", "pagado", "comprobante_enviado"];

  // 🔥 PRIORIDAD 1 - Sin urgencia / caso cerrado
  if (
    saldoVencido === 0 &&
    !llamarOtraVez ||
    etiquetasCerradas.some(tag => estadoEtiqueta.includes(tag))
  ) {
    return {
      prioridad: 1,
      prioridad_porque: "No existe deuda ni acción pendiente. Caso cerrado.",
      confianza: 0.95
    };
  }

  // 🔥 PRIORIDAD 2 - Urgencia baja (Cliente al día)
  if (
    saldoVencido === 0 &&
    comprobanteEnviado &&
    tipoDePago === "total" &&
    !llamarOtraVez
  ) {
    return {
      prioridad: 2,
      prioridad_porque: "Cliente al día, comprobante confirmado. No requiere gestión.",
      confianza: 0.90
    };
  }

  // 🔥 PRIORIDAD 5 - Máxima urgencia
  if (
    saldoVencido > 0 &&
    !comprobanteEnviado &&
    !tieneCompromiso &&
    (diceQueYaPago || etiquetasEvasivas.some(tag => estadoEtiqueta.includes(tag))) &&
    llamarOtraVez
  ) {
    return {
      prioridad: 5,
      prioridad_porque: "Cliente con deuda pendiente sin comprobante, sin compromiso y alta probabilidad de morosidad.",
      confianza: 0.95
    };
  }

  // Caso alternativo de Prioridad 5 (sin etiquetas evasivas pero con alta deuda)
  if (
    saldoVencido > 0 &&
    !comprobanteEnviado &&
    !tieneCompromiso &&
    llamarOtraVez
  ) {
    return {
      prioridad: 5,
      prioridad_porque: "Cliente con deuda alta sin comprobante ni compromiso. Requiere contacto urgente.",
      confianza: 0.85
    };
  }

  // 🔥 PRIORIDAD 4 - Urgencia alta
  if (
    saldoVencido > 0 &&
    (tipoDePago === "parcial" || restanteSaldo > 0) &&
    (tieneCompromiso || etiquetasPositivas.some(tag => estadoEtiqueta.includes(tag)))
  ) {
    return {
      prioridad: 4,
      prioridad_porque: "Cliente con deuda activa y señales de pago parcial o compromiso, requiere seguimiento.",
      confianza: 0.80
    };
  }

  // 🔥 PRIORIDAD 3 - Urgencia media
  if (
    saldoVencido > 0 &&
    (comprobanteEnviado || tieneCompromiso) &&
    llamarOtraVez
  ) {
    return {
      prioridad: 3,
      prioridad_porque: "Cliente con compromiso o comprobante pendiente de validación. Seguimiento moderado.",
      confianza: 0.60
    };
  }

  // Default: Prioridad 3 si tiene deuda
  if (saldoVencido > 0) {
    return {
      prioridad: 3,
      prioridad_porque: "Cliente con deuda pendiente. Requiere evaluación.",
      confianza: 0.50
    };
  }

  // Fallback
  return {
    prioridad: 2,
    prioridad_porque: "Situación no clasificada. Revisión manual recomendada.",
    confianza: 0.40
  };
};

// Función para obtener el color y emoji según la prioridad
const getPriorityBadge = (prioridad: number) => {
  switch (prioridad) {
    case 5:
      return { color: "bg-red-100 text-red-800 border-red-300", emoji: "🔥", label: "URGENTE" };
    case 4:
      return { color: "bg-orange-100 text-orange-800 border-orange-300", emoji: "⚠️", label: "ALTA" };
    case 3:
      return { color: "bg-yellow-100 text-yellow-800 border-yellow-300", emoji: "⏰", label: "MEDIA" };
    case 2:
      return { color: "bg-green-100 text-green-800 border-green-300", emoji: "✅", label: "BAJA" };
    case 1:
      return { color: "bg-gray-100 text-gray-600 border-gray-300", emoji: "📁", label: "CERRADO" };
    default:
      return { color: "bg-gray-100 text-gray-600 border-gray-300", emoji: "❓", label: "SIN CLASIFICAR" };
  }
};

const ConversationHistoryTab = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [comprobanteFilter, setComprobanteFilter] = useState<"todos" | "enviado" | "no_enviado">("todos");
  const [priorityFilter, setPriorityFilter] = useState<"todos" | "5" | "4" | "3" | "2" | "1">("todos");
  const [selectedRecord, setSelectedRecord] = useState<ConversationRecord | null>(null);

  // Consulta para obtener todos los registros con conversation_id válido
  const { data: allRecords, isLoading: isLoadingAll } = useQuery({
    queryKey: ["conversation-records-v3"], // Cambiar key para forzar refetch
    queryFn: async () => {
      console.log("🔍 Obteniendo TODOS los registros con conversaciones...");

      // Obtener TODOS los registros usando paginación manual
      let allData: any[] = [];
      let page = 0;
      const pageSize = 1000;
      let hasMoreData = true;

      while (hasMoreData) {
        console.log(`📖 Obteniendo página ${page + 1}...`);
        const { data, error, count } = await supabase
          .from("POINT_Competencia")
          .select(`
            idCompra,
            Cliente,
            Cedula,
            Celular,
            conversation_id,
            Segmento,
            Status,
            Articulo,
            ComprobanteEnviado,
            SaldoVencido,
            DiceQueYaPago,
            LlamarOtraVez,
            compromiso_pago_fecha,
            TipoDePago,
            RestanteSaldoVencido,
            EstadoEtiqueta
          `, { count: 'exact' })
          .not("conversation_id", "is", null)
          .neq("conversation_id", 0)
          .range(page * pageSize, (page + 1) * pageSize - 1)
          .order("Cliente", { ascending: true });

        if (error) {
          console.error("❌ Error obteniendo registros:", error);
          break;
        }

        if (data && data.length > 0) {
          allData = [...allData, ...data];
          console.log(`✅ Página ${page + 1}: ${data.length} registros obtenidos`);
          console.log(`📈 Total acumulado: ${allData.length} registros`);

          // Log del total esperado en la primera página
          if (page === 0 && count) {
            console.log(`🎯 Total esperado en la base de datos: ${count} registros`);
          }

          // Continuar si hemos obtenido exactamente pageSize registros
          // Solo parar cuando obtengamos menos registros o cuando alcancemos el total
          if (data.length === pageSize && (!count || allData.length < count)) {
            page++;
          } else {
            hasMoreData = false;
          }
        } else {
          hasMoreData = false;
        }
      }

      console.log(`🎯 TOTAL FINAL obtenido: ${allData.length} registros`);
      console.log(`📊 Cada registro = 1 conversación individual (puede haber múltiples conversaciones por persona)`);

      return allData as ConversationRecord[];
    },
    retry: 2,
    staleTime: 5 * 60 * 1000, // 5 minutos
  });

  // Query para obtener el detalle del cliente seleccionado y su conversación
  const { data: customerData, isLoading: isLoadingDetail } = useQuery({
    queryKey: ["customer-conversation-detail", selectedRecord?.idCompra],
    queryFn: async () => {
      if (!selectedRecord) return null;

      console.log("🔍 Loading conversation detail for record:", selectedRecord.idCompra);

      try {
        console.log(`📞 Llamando webhook n8n para conversation_id: ${selectedRecord.conversation_id}`);

        const response = await fetch(N8N_WEBHOOK_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            conversation_id: selectedRecord.conversation_id
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Error HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log("✅ Respuesta del webhook:", data);

        // El webhook puede devolver un array o un objeto
        const historyData = Array.isArray(data) ? data[0] : data;

        if (!historyData || !historyData.mensajes) {
          throw new Error("Formato de respuesta inválido del webhook");
        }

        // Ordenar mensajes por fecha
        const mensajesOrdenados = historyData.mensajes.sort((a: ConversationMessage, b: ConversationMessage) =>
          new Date(a.fecha_iso).getTime() - new Date(b.fecha_iso).getTime()
        );

        return {
          customer: selectedRecord,
          conversations: {
            ...historyData,
            mensajes: mensajesOrdenados
          }
        };

      } catch (error) {
        console.error("❌ Error obteniendo historial:", error);
        throw error;
      }
    },
    enabled: !!selectedRecord
  });  // Filtrar registros según el término de búsqueda, filtro de comprobante y prioridad
  const filteredRecords = allRecords?.filter(record => {
    // Filtro de búsqueda por texto
    const searchMatches = !searchTerm.trim() || (() => {
      const search = searchTerm.toLowerCase();
      return (
        record.Cliente?.toLowerCase().includes(search) ||
        record.Cedula?.toString().includes(search) ||
        record.Celular?.toString().includes(search) ||
        record.idCompra?.toString().includes(search) ||
        record.conversation_id?.toString().includes(search)
      );
    })();

    // Filtro de comprobante enviado
    const comprobanteMatches = (() => {
      switch (comprobanteFilter) {
        case "enviado":
          return record.ComprobanteEnviado === "SI";
        case "no_enviado":
          return record.ComprobanteEnviado !== "SI";
        case "todos":
        default:
          return true;
      }
    })();

    // Filtro de prioridad
    const priorityMatches = (() => {
      if (priorityFilter === "todos") return true;
      const priority = calculatePriority(record);
      return priority.prioridad === parseInt(priorityFilter);
    })();

    return searchMatches && comprobanteMatches && priorityMatches;
  });
  // Calcular estadísticas PRIMERO: total conversaciones (todas las filas)
  const totalConversaciones = allRecords?.length || 0;
  const conComprobanteEnviado = allRecords?.filter(r => r.ComprobanteEnviado === "SI").length || 0;
  const sinComprobanteEnviado = totalConversaciones - conComprobanteEnviado;
  // 👥 DEDUPLICAR POR CÉDULA para la lista visual - Mostrar PERSONAS ÚNICAS
  // Mantener solo la conversación más reciente (mayor idCompra) por cada persona
  const uniqueFilteredRecords = filteredRecords?.reduce((acc, current) => {
    const existing = acc.find(record => record.Cedula === current.Cedula);

    if (!existing) {
      acc.push(current);
    } else {
      // Si ya existe, mantener el que tenga mayor idCompra (más reciente)
      if (current.idCompra > existing.idCompra) {
        const index = acc.findIndex(record => record.Cedula === current.Cedula);
        acc[index] = current;
      }
    }

    return acc;
  }, [] as ConversationRecord[])
    // Ordenar por prioridad (mayor prioridad primero)
    ?.sort((a, b) => {
      const priorityA = calculatePriority(a).prioridad;
      const priorityB = calculatePriority(b).prioridad;
      return priorityB - priorityA; // Orden descendente: 5, 4, 3, 2, 1
    });

  // Calcular personas únicas (basado en la lista deduplicada)
  const personasUnicas = uniqueFilteredRecords?.length || 0;

  // Calcular estadísticas de prioridad
  const prioridadStats = uniqueFilteredRecords?.reduce((acc, record) => {
    const priority = calculatePriority(record).prioridad;
    acc[priority] = (acc[priority] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);// Función para formatear texto con markdown (convertir **texto** y *texto* a <strong>texto</strong>)
  const formatMarkdownText = (text: string) => {
    // Primero convertir **texto** a <strong>texto</strong>
    let formattedText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Luego convertir *texto* a <strong>texto</strong> (pero evitar conflictos con texto ya formateado)
    formattedText = formattedText.replace(/\*([^*<>]+?)\*/g, function (match, p1) {
      // Verificar que no esté dentro de un tag <strong> existente
      return '<strong>' + p1 + '</strong>';
    });

    return formattedText;
  };
  // Función para parsear mensajes
  const parseMessage = (message: ConversationMessage) => {
    const messageText = message.texto?.trim() || "";

    // Filtrar mensajes de estado del sistema - PARA CUALQUIER ROL
    if (messageText) {
      // Patrones más específicos para capturar TODOS los mensajes del sistema
      const estadosSistemaPatterns = [
        // Patrones en español
        /\b\w+\s+(agregó|añadió|eliminó|quitó|modificó|cambió|actualizó)/i,
        /\b\w+\s+(agregó|añadió|eliminó|quitó|modificó|cambió|actualizó)\s+/i,
        /^(agregó|añadió|eliminó|quitó|modificó|cambió|actualizó)/i,

        // Patrones en inglés (común en sistemas)
        /\b\w+\s+(added|removed|deleted|updated|modified|changed)/i,
        /\b\w+\s+(added|removed|deleted|updated|modified|changed)\s+/i,
        /^(added|removed|deleted|updated|modified|changed)/i,

        // Patrones específicos de Chatwoot/Paolo
        /^Paolo\s+(agregó|añadió|eliminó|quitó|modificó|cambió|actualizó|added|removed|deleted|updated)/i,
        /Paolo\s+(added|removed|deleted|updated|modified|changed)/i,
        /Conversación no asignada por Paolo/i,

        // Patrones para campos específicos como "comprobante_enviado"
        /\w+\s+(added|removed)\s+\w+/i,
        /\w+\s+(agregó|eliminó)\s+\w+/i,

        // Errores del sistema
        /\[ERROR\s+EXTERNO\]/i,
        /\(#\d+\)/,

        // Patrones para mensajes vacíos o de sistema
        /^null$/i,
        /^undefined$/i,
        /^\s*$/,

        // Patrones para acciones de etiquetas/labels
        /\w+\s+(added|removed|applied|deleted)\s+(label|tag|etiqueta)/i,
        /\w+\s+(agregó|eliminó|aplicó)\s+(etiqueta|label)/i
      ];
      const isStateMessage = estadosSistemaPatterns.some(pattern => pattern.test(messageText));
      if (isStateMessage) {
        console.log("🚫 Mensaje del sistema filtrado:", messageText, "- Rol:", message.rol);
        return null; // No mostrar estos mensajes
      }
    }

    // 🔴 PRIORIDAD ALTA: Detectar mensaje específico de Banco Pichincha (SIEMPRE indica imagen enviada)
    if (messageText === "Enviado desde mi nueva Banca Móvil de Banco Pichincha") {
      console.log("✅ Detectado mensaje de Banco Pichincha - Mostrando: IMAGEN ENVIADA");
      return "<strong>IMAGEN ENVIADA</strong>";
    }

    // Detectar tipo de archivo según el campo 'tipo' del mensaje
    if (!messageText) {
      if (message.rol === "BOT") {
        return "<strong>PLANTILLA PERSONALIZADA WHATSAPP</strong>";
      }

      // Diferenciar entre imagen y audio según el tipo
      const tipo = message.tipo?.toLowerCase() || "";
      console.log("🔍 Mensaje sin texto. Tipo detectado:", tipo);

      if (tipo.includes("audio") || tipo.includes("voice")) {
        return "<strong>AUDIO DE VOZ</strong>";
      } else if (tipo.includes("image") || tipo.includes("imagen")) {
        return "<strong>IMAGEN ENVIADA</strong>";
      } else {
        // Fallback si no se puede determinar el tipo
        return "<strong>ARCHIVO MULTIMEDIA</strong>";
      }
    }

    // Cambiar [Sin contenido] por tipo específico
    if (messageText === "[Sin contenido]") {
      const tipo = message.tipo?.toLowerCase() || "";
      console.log("🔍 [Sin contenido] detectado. Tipo:", tipo);

      if (tipo.includes("audio") || tipo.includes("voice")) {
        return "<strong>AUDIO DE VOZ</strong>";
      } else if (tipo.includes("image") || tipo.includes("imagen")) {
        return "<strong>IMAGEN ENVIADA</strong>";
      } else {
        return "<strong>ARCHIVO MULTIMEDIA</strong>";
      }
    }

    // Formatear texto con markdown
    return formatMarkdownText(messageText);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Conversaciones de WhatsApp</h2>
        <p className="text-muted-foreground">Busca por cédula, celular, nombre o ID de compra para ver el historial de conversaciones del cliente</p>
      </div>

      <Card className="border-2 border-blue-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="w-5 h-5" />
            Buscar Cliente
          </CardTitle>
        </CardHeader>        <CardContent>
          <div className="flex gap-4 flex-wrap">
            <Input
              placeholder="Busca por nombre, cédula, celular o ID de compra..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 min-w-[300px]"
            />
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <Select value={comprobanteFilter} onValueChange={(value: "todos" | "enviado" | "no_enviado") => setComprobanteFilter(value)}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Filtrar por comprobante" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos los clientes</SelectItem>
                  <SelectItem value="enviado">Comprobante enviado</SelectItem>
                  <SelectItem value="no_enviado">Sin comprobante</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <Select value={priorityFilter} onValueChange={(value: "todos" | "5" | "4" | "3" | "2" | "1") => setPriorityFilter(value)}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Filtrar por prioridad" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todas las prioridades</SelectItem>
                  <SelectItem value="5">🔥 Prioridad 5 - URGENTE</SelectItem>
                  <SelectItem value="4">⚠️ Prioridad 4 - ALTA</SelectItem>
                  <SelectItem value="3">⏰ Prioridad 3 - MEDIA</SelectItem>
                  <SelectItem value="2">✅ Prioridad 2 - BAJA</SelectItem>
                  <SelectItem value="1">📁 Prioridad 1 - CERRADO</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoadingAll ? (
        <LoadingState
          title="Cargando clientes..."
          message="Buscando todos los clientes con conversaciones activas en el sistema."
          skeletonCount={4}
        />
      ) : (
        <>
          {/* Lista de clientes */}
          {uniqueFilteredRecords && uniqueFilteredRecords.length > 0 && !selectedRecord && (
            <Card className="border-2 border-blue-200">
              <CardHeader>
                <CardTitle>Clientes con Conversaciones ({personasUnicas})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  <MetricCard
                    title="Total Conversaciones"
                    value={totalConversaciones}
                    icon={MessageSquare}
                    variant="primary"
                    description="Total de chats registrados"
                  />
                  <MetricCard
                    title="Personas Únicas"
                    value={personasUnicas}
                    icon={Users}
                    variant="primary"
                    description="Clientes únicos atendidos"
                  />
                  <MetricCard
                    title="Con Comprobante"
                    value={conComprobanteEnviado}
                    icon={CheckCircle}
                    variant="success"
                    description="Enviaron comprobante"
                  />
                  <MetricCard
                    title="Sin Comprobante"
                    value={sinComprobanteEnviado}
                    icon={AlertCircle}
                    variant="destructive"
                    description="Pendientes de comprobante"
                  />
                </div>

                <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                  <div className="flex gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-muted-foreground">📊 Por Prioridad:</p>
                    {prioridadStats?.[5] && (
                      <Badge className="bg-red-100 text-red-800 border-red-300">
                        🔥 P5: {prioridadStats[5]}
                      </Badge>
                    )}
                    {prioridadStats?.[4] && (
                      <Badge className="bg-orange-100 text-orange-800 border-orange-300">
                        ⚠️ P4: {prioridadStats[4]}
                      </Badge>
                    )}
                    {prioridadStats?.[3] && (
                      <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">
                        ⏰ P3: {prioridadStats[3]}
                      </Badge>
                    )}
                    {prioridadStats?.[2] && (
                      <Badge className="bg-green-100 text-green-800 border-green-300">
                        ✅ P2: {prioridadStats[2]}
                      </Badge>
                    )}
                    {prioridadStats?.[1] && (
                      <Badge className="bg-gray-100 text-gray-600 border-gray-300">
                        📁 P1: {prioridadStats[1]}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                  <p className="text-sm text-purple-800">
                    <strong>ℹ️ Nota:</strong> Esta lista muestra <strong>personas únicas</strong> ({personasUnicas} clientes).
                    Si una persona tiene múltiples conversaciones, solo se muestra su conversación más reciente.
                    El total de conversaciones registradas en el sistema es <strong>{totalConversaciones}</strong>.
                  </p>
                </div>

                <ScrollArea className="h-[400px]">
                  <div className="space-y-2">
                    {uniqueFilteredRecords.map((record) => {
                      const priority = calculatePriority(record);
                      const priorityBadge = getPriorityBadge(priority.prioridad);

                      return (
                        <div
                          key={record.Cedula}
                          className="p-4 border-2 border-blue-200 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                          onClick={() => setSelectedRecord(record)}
                        >
                          <div className="flex justify-between items-start gap-3">
                            <div className="space-y-1 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-semibold">{record.Cliente}</p>
                                <Badge variant="outline" className="text-xs">
                                  💬 Conv #{record.conversation_id}
                                </Badge>
                                <Badge className={`text-xs font-bold border ${priorityBadge.color}`}>
                                  {priorityBadge.emoji} P{priority.prioridad} - {priorityBadge.label}
                                </Badge>
                              </div>
                              <div className="text-sm text-muted-foreground space-y-1">
                                <p>🆔 Cédula: {record.Cedula}</p>
                                <p>📱 Celular: {record.Celular}</p>
                                <p>🛒 Última compra: {record.idCompra}</p>
                                {record.Articulo && <p>📦 Artículo: {record.Articulo}</p>}
                                {record.SaldoVencido !== undefined && record.SaldoVencido > 0 && (
                                  <div className="mt-1 px-2 py-1 rounded-md border-2 border-blue-200 hover:border-blue-600 hover:scale-105 transition-all duration-300 w-fit bg-white/50">
                                    <p className="font-semibold text-red-600">💰 Saldo Vencido: ${record.SaldoVencido.toFixed(2)}</p>
                                  </div>
                                )}
                              </div>
                              <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs">
                                <p className="font-semibold text-blue-800">📋 Razón de Prioridad:</p>
                                <p className="text-blue-700">{priority.prioridad_porque}</p>
                                <p className="text-blue-600 mt-1">🎯 Confianza: {(priority.confianza * 100).toFixed(0)}%</p>
                              </div>
                            </div>
                            <div className="flex flex-col gap-2 items-end">
                              {record.ComprobanteEnviado === "SI" && (
                                <Badge className="bg-green-500 hover:bg-green-600">
                                  ✅ Comprobante Enviado
                                </Badge>
                              )}
                              {record.LlamarOtraVez === "SI" && (
                                <Badge className="bg-orange-500 hover:bg-orange-600">
                                  📞 Llamar Otra Vez
                                </Badge>
                              )}
                              {record.compromiso_pago_fecha && (
                                <Badge className="bg-purple-500 hover:bg-purple-600">
                                  📅 Compromiso: {new Date(record.compromiso_pago_fecha).toLocaleDateString()}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </CardContent >
            </Card >
          )}

          {/* Detalle del cliente seleccionado */}
          {
            selectedRecord && (
              <div className="space-y-4">
                <Button
                  variant="outline"
                  onClick={() => setSelectedRecord(null)}
                  className="mb-4"
                >
                  ← Volver a la lista
                </Button>

                {isLoadingDetail ? (
                  <LoadingState
                    title="Cargando detalles del cliente..."
                    message="Obteniendo información completa y historial de conversaciones."
                    skeletonCount={3}
                  />
                ) : customerData?.customer ? (
                  <>                  {/* Customer Information Card */}
                    <Card className="border-2 border-blue-200">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 justify-between flex-wrap">
                          <span className="flex items-center gap-2">
                            <User className="w-5 h-5" />
                            Información del Cliente
                          </span>
                          {(() => {
                            const priority = calculatePriority(customerData.customer);
                            const priorityBadge = getPriorityBadge(priority.prioridad);
                            return (
                              <Badge className={`text-sm font-bold border ${priorityBadge.color}`}>
                                {priorityBadge.emoji} Prioridad {priority.prioridad} - {priorityBadge.label}
                              </Badge>
                            );
                          })()}
                        </CardTitle>
                        {(() => {
                          const priority = calculatePriority(customerData.customer);
                          return (
                            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                              <p className="text-sm font-semibold text-blue-800">📋 Análisis de Prioridad:</p>
                              <p className="text-sm text-blue-700 mt-1">{priority.prioridad_porque}</p>
                              <p className="text-sm text-blue-600 mt-1">🎯 Nivel de Confianza: {(priority.confianza * 100).toFixed(0)}%</p>
                            </div>
                          );
                        })()}
                      </CardHeader>                    <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                            <User className="w-5 h-5 text-primary" />
                            <div>
                              <p className="text-sm text-muted-foreground">Cliente</p>
                              <p className="font-semibold">{customerData.customer.Cliente || "N/A"}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                            <CreditCard className="w-5 h-5 text-primary" />
                            <div>
                              <p className="text-sm text-muted-foreground">Cédula</p>
                              <p className="font-semibold">{customerData.customer.Cedula || "N/A"}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                            <Phone className="w-5 h-5 text-primary" />
                            <div>
                              <p className="text-sm text-muted-foreground">Celular</p>
                              <p className="font-semibold">{customerData.customer.Celular || "N/A"}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                            <Package className="w-5 h-5 text-primary" />
                            <div>
                              <p className="text-sm text-muted-foreground">Artículo</p>
                              <p className="font-semibold">{customerData.customer.Articulo || "N/A"}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                            <MessageCircle className="w-5 h-5 text-primary" />
                            <div>
                              <p className="text-sm text-muted-foreground">ID de Compra</p>
                              <p className="font-semibold">{customerData.customer.idCompra || "N/A"}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                            <MessageCircle className="w-5 h-5 text-primary" />
                            <div>
                              <p className="text-sm text-muted-foreground">ID Conversación</p>
                              <p className="font-semibold">{customerData.customer.conversation_id || "N/A"}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                            <div className="w-5 h-5" />
                            <div>
                              <p className="text-sm text-muted-foreground">Estado de Comprobante</p>
                              {customerData.customer.ComprobanteEnviado === "SI" ? (
                                <Badge className="bg-green-500 hover:bg-green-600">
                                  Comprobante Enviado
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="border-orange-500 text-orange-500">
                                  Pendiente
                                </Badge>
                              )}
                            </div>
                          </div>

                          {customerData.customer.SaldoVencido !== undefined && (
                            <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg border border-red-200">
                              <AlertCircle className="w-5 h-5 text-red-600" />
                              <div>
                                <p className="text-sm text-muted-foreground">Saldo Vencido</p>
                                <p className="font-bold text-red-600">${customerData.customer.SaldoVencido.toFixed(2)}</p>
                              </div>
                            </div>
                          )}

                          {customerData.customer.RestanteSaldoVencido !== undefined && customerData.customer.RestanteSaldoVencido > 0 && (
                            <div className="flex items-center gap-3 p-3 bg-orange-50 rounded-lg border border-orange-200">
                              <AlertCircle className="w-5 h-5 text-orange-600" />
                              <div>
                                <p className="text-sm text-muted-foreground">Saldo Restante</p>
                                <p className="font-bold text-orange-600">${customerData.customer.RestanteSaldoVencido.toFixed(2)}</p>
                              </div>
                            </div>
                          )}

                          {customerData.customer.TipoDePago && (
                            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                              <CreditCard className="w-5 h-5 text-primary" />
                              <div>
                                <p className="text-sm text-muted-foreground">Tipo de Pago</p>
                                <p className="font-semibold capitalize">{customerData.customer.TipoDePago}</p>
                              </div>
                            </div>
                          )}

                          {customerData.customer.compromiso_pago_fecha && (
                            <div className="flex items-center gap-3 p-3 bg-purple-50 rounded-lg border border-purple-200">
                              <Package className="w-5 h-5 text-purple-600" />
                              <div>
                                <p className="text-sm text-muted-foreground">Compromiso de Pago</p>
                                <p className="font-bold text-purple-600">
                                  {new Date(customerData.customer.compromiso_pago_fecha).toLocaleDateString('es', {
                                    day: '2-digit',
                                    month: 'long',
                                    year: 'numeric'
                                  })}
                                </p>
                              </div>
                            </div>
                          )}

                          {customerData.customer.LlamarOtraVez && (
                            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                              <Phone className="w-5 h-5 text-primary" />
                              <div>
                                <p className="text-sm text-muted-foreground">Llamar Otra Vez</p>
                                <Badge className={customerData.customer.LlamarOtraVez === "SI" ? "bg-orange-500" : "bg-gray-500"}>
                                  {customerData.customer.LlamarOtraVez || "NO"}
                                </Badge>
                              </div>
                            </div>
                          )}

                          {customerData.customer.DiceQueYaPago && (
                            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                              <MessageCircle className="w-5 h-5 text-primary" />
                              <div>
                                <p className="text-sm text-muted-foreground">Dice Que Ya Pagó</p>
                                <Badge className={customerData.customer.DiceQueYaPago === "SI" ? "bg-blue-500" : "bg-gray-500"}>
                                  {customerData.customer.DiceQueYaPago || "NO"}
                                </Badge>
                              </div>
                            </div>
                          )}

                          {customerData.customer.EstadoEtiqueta && (
                            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                              <Package className="w-5 h-5 text-primary" />
                              <div>
                                <p className="text-sm text-muted-foreground">Estado/Etiqueta</p>
                                <Badge variant="outline">{customerData.customer.EstadoEtiqueta}</Badge>
                              </div>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Conversation History Card */}
                    <Card className="border-2 border-blue-200">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <MessageCircle className="w-5 h-5" />
                          Historial de Conversación
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {!customerData.conversations || customerData.conversations.mensajes.length === 0 ? (
                          <div className="text-center py-12">
                            <MessageCircle className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                            <p className="text-lg font-medium text-muted-foreground">
                              No hay conversaciones disponibles
                            </p>
                            <p className="text-sm text-muted-foreground mt-2">
                              Este cliente no tiene historial de conversaciones registrado
                            </p>
                          </div>
                        ) : (
                          <ScrollArea className="h-[600px] pr-4">
                            <div className="space-y-3 py-2">                            {customerData.conversations.mensajes.map((msg: ConversationMessage, idx: number) => {
                              const messageText = parseMessage(msg);
                              const isBot = msg.rol === "BOT";
                              const timestamp = new Date(msg.fecha_iso).toLocaleString('es-ES', {
                                hour: '2-digit',
                                minute: '2-digit',
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric'
                              });

                              // Filtrar mensajes nulos (estados del bot) y mensajes vacíos
                              if (messageText === null || !messageText || messageText.trim() === "") return null;

                              return (
                                <div
                                  key={msg.id || idx}
                                  className={`flex ${!isBot ? 'justify-start' : 'justify-end'}`}
                                >
                                  <div className={`flex flex-col ${!isBot ? 'items-start' : 'items-end'} max-w-[75%]`}>
                                    <div className="text-xs text-muted-foreground mb-1 px-2">
                                      {!isBot ? customerData.customer.Cliente : "Bot POINT"}
                                    </div>
                                    <div
                                      className={`rounded-2xl px-4 py-2.5 ${!isBot
                                        ? 'bg-muted text-foreground rounded-tl-none'
                                        : 'bg-primary text-primary-foreground rounded-tr-none'
                                        }`}                                    >
                                      {messageText.includes('<strong>') ? (
                                        <p
                                          className="text-sm whitespace-pre-wrap break-words"
                                          dangerouslySetInnerHTML={{ __html: messageText }}
                                        />
                                      ) : (
                                        <p className="text-sm whitespace-pre-wrap break-words">
                                          {messageText}
                                        </p>
                                      )}
                                      <div className={`text-[10px] mt-1 ${!isBot ? 'text-muted-foreground' : 'text-primary-foreground/70'}`}>
                                        {timestamp}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                            </div>
                          </ScrollArea>
                        )}
                      </CardContent>
                    </Card>
                  </>
                ) : (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Error al cargar el historial de conversación. Por favor intenta nuevamente.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )
          }

          {
            !isLoadingAll && uniqueFilteredRecords && uniqueFilteredRecords.length === 0 && (
              <Card className="border-2 border-blue-200">
                <CardContent className="py-12">
                  <div className="text-center">
                    <Search className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                    <p className="text-lg font-medium text-muted-foreground">
                      No se encontraron resultados
                    </p>
                    <p className="text-sm text-muted-foreground mt-2">
                      Intenta buscar con otra cédula, celular, nombre o ID de compra
                    </p>
                  </div>
                </CardContent>            </Card>
            )
          }
        </>
      )}
    </div >
  );
};

export default ConversationHistoryTab;
