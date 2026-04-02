import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, User, Phone, CreditCard, MessageCircle, Package, Bot, AlertCircle, Filter, CheckCircle, Users, MessageSquare, ShoppingBag, DollarSign } from "lucide-react";
import MetricCard from "./MetricCard";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import LoadingState from "@/components/ui/loading-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

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
  const { data: allRecordsData, isLoading: isLoadingAll } = useQuery({
    queryKey: ["conversation-records-v3"],
    queryFn: async () => {
      console.log("🔍 Obteniendo TODOS los registros con conversaciones...");
      let allData: any[] = [];
      let page = 0;
      const pageSize = 1000;
      let hasMoreData = true;

      while (hasMoreData) {
        const { data, error, count } = await supabase
          .from("POINT_Competencia")
          .select(`
            idCompra, Cliente, Cedula, Celular, conversation_id, Segmento, Status, Articulo,
            ComprobanteEnviado, SaldoVencido, DiceQueYaPago, LlamarOtraVez, 
            compromiso_pago_fecha, TipoDePago, RestanteSaldoVencido, EstadoEtiqueta
          `, { count: 'exact' })
          .not("conversation_id", "is", null)
          .neq("conversation_id", 0)
          .range(page * pageSize, (page + 1) * pageSize - 1)
          .order("idCompra", { ascending: false });

        if (error) {
          console.error("❌ Error obteniendo registros:", error);
          break;
        }

        if (data && data.length > 0) {
          allData = [...allData, ...data];
          if (data.length === pageSize && (!count || allData.length < count)) {
            page++;
          } else {
            hasMoreData = false;
          }
        } else {
          hasMoreData = false;
        }
      }
      return allData as ConversationRecord[];
    },
    retry: 2,
    staleTime: 5 * 60 * 1000,
  });

  // Query para obtener el detalle del cliente seleccionado y su conversación
  const { data: customerData, isLoading: isLoadingDetail } = useQuery({
    queryKey: ["customer-conversation-detail", selectedRecord?.idCompra],
    queryFn: async () => {
      if (!selectedRecord) return null;
      try {
        const response = await fetch(N8N_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversation_id: selectedRecord.conversation_id }),
        });

        if (!response.ok) throw new Error(`Error HTTP ${response.status}`);
        const data = await response.json();
        const historyData = Array.isArray(data) ? data[0] : data;

        if (!historyData || !historyData.mensajes) throw new Error("Sin mensajes");

        const mensajesOrdenados = historyData.mensajes.sort((a: ConversationMessage, b: ConversationMessage) =>
          new Date(a.fecha_iso).getTime() - new Date(b.fecha_iso).getTime()
        );

        return {
          customer: selectedRecord,
          conversations: { ...historyData, mensajes: mensajesOrdenados }
        };
      } catch (error) {
        console.error("❌ Error obteniendo historial:", error);
        throw error;
      }
    },
    enabled: !!selectedRecord
  });

  // --- LÓGICA DE DATOS SINCRONIZADA ---

  // 1. Obtener registros únicos base (el más reciente por cada cédula)
  const uniqueBaseRecords = (allRecordsData || []).reduce((acc: ConversationRecord[], current) => {
    const existingIndex = acc.findIndex(record => record.Cedula === current.Cedula);
    if (existingIndex === -1) {
      acc.push(current);
    } else {
      if (current.idCompra > acc[existingIndex].idCompra) {
        acc[existingIndex] = current;
      }
    }
    return acc;
  }, []);

  // 2. Aplicar FILTROS sobre la lista de registros ÚNICOS
  const filteredUniqueRecords = uniqueBaseRecords.filter(record => {
    const search = searchTerm.toLowerCase().trim();
    const searchMatches = !search ||
      record.Cliente?.toLowerCase().includes(search) ||
      record.Cedula?.toString().includes(search) ||
      record.Celular?.toString().includes(search) ||
      record.idCompra?.toString().includes(search);

    const comprobanteMatches =
      comprobanteFilter === "todos" ||
      (comprobanteFilter === "enviado" && record.ComprobanteEnviado === "SI") ||
      (comprobanteFilter === "no_enviado" && record.ComprobanteEnviado !== "SI");

    const priorityMatches = priorityFilter === "todos" ||
      calculatePriority(record).prioridad === parseInt(priorityFilter);

    return searchMatches && comprobanteMatches && priorityMatches;
  }).sort((a, b) => calculatePriority(b).prioridad - calculatePriority(a).prioridad);

  // 3. ESTADÍSTICAS basadas estrictamente en la lista filtrada final
  const personasUnicasCount = filteredUniqueRecords.length;
  const conComprobanteEnviado = filteredUniqueRecords.filter(r => r.ComprobanteEnviado === "SI").length;
  const sinComprobanteEnviado = personasUnicasCount - conComprobanteEnviado;

  const prioridadStats = filteredUniqueRecords.reduce((acc: Record<number, number>, record) => {
    const p = calculatePriority(record).prioridad;
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});

  const formatMarkdownText = (text: string) => {
    let formattedText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formattedText = formattedText.replace(/\*([^*<>]+?)\*/g, '<strong>$1</strong>');
    return formattedText;
  };

  const parseMessage = (message: ConversationMessage) => {
    const messageText = message.texto?.trim() || "";
    if (messageText) {
      const systemPatterns = [/\b\w+\s+(agregó|añadió|eliminó|quitó|modificó|cambió|actualizó)/i, /Paolo\s+/i, /Conversación no asignada/i];
      if (systemPatterns.some(p => p.test(messageText))) return null;
    }
    if (messageText === "Enviado desde mi nueva Banca Móvil de Banco Pichincha") return "<strong>IMAGEN ENVIADA</strong>";
    if (!messageText || messageText === "[Sin contenido]") {
      const t = message.tipo?.toLowerCase() || "";
      if (t.includes("audio") || t.includes("voice")) return "<strong>AUDIO DE VOZ</strong>";
      if (t.includes("image")) return "<strong>IMAGEN ENVIADA</strong>";
      return "<strong>ARCHIVO MULTIMEDIA</strong>";
    }
    return formatMarkdownText(messageText);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Conversaciones de WhatsApp</h2>
        <p className="text-muted-foreground text-sm">Busca clientes únicos para ver su historial más reciente</p>
      </div>

      <Card className="border-2 border-blue-200">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Search className="w-5 h-5 text-blue-600" />
            Filtros de Búsqueda
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 flex-wrap">
            <div className="flex-1 min-w-[300px] relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Nombre, cédula, celular o ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={comprobanteFilter} onValueChange={(v: any) => setComprobanteFilter(v)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Comprobante" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los estados</SelectItem>
                <SelectItem value="enviado">Con comprobante</SelectItem>
                <SelectItem value="no_enviado">Sin comprobante</SelectItem>
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={(v: any) => setPriorityFilter(v)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Prioridad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas las prioridades</SelectItem>
                <SelectItem value="5">🔥 P5 - URGENTE</SelectItem>
                <SelectItem value="4">⚠️ P4 - ALTA</SelectItem>
                <SelectItem value="3">⏰ P3 - MEDIA</SelectItem>
                <SelectItem value="2">✅ P2 - BAJA</SelectItem>
                <SelectItem value="1">📁 P1 - CERRADO</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isLoadingAll ? (
        <LoadingState title="Cargando clientes..." message="Buscando registros únicos..." skeletonCount={4} />
      ) : (
        <>
          {/* MÉTRICAS UNIFICADAS */}
          {!selectedRecord && (
            <Card className="border-2 border-blue-200 shadow-sm">
              <CardHeader className="py-4 border-b">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Resumen de Clientes Filtrados</span>
                  <Badge variant="secondary">{personasUnicasCount} clientes actuales</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <MetricCard
                    title="Total Clientes"
                    value={personasUnicasCount}
                    icon={Users}
                    variant="primary"
                    description="Personas únicas tras filtros"
                  />
                  <MetricCard
                    title="Con Comprobante"
                    value={conComprobanteEnviado}
                    icon={CheckCircle}
                    variant="success"
                    description="Clientes que enviaron recibo"
                  />
                  <MetricCard
                    title="Sin Comprobante"
                    value={sinComprobanteEnviado}
                    icon={AlertCircle}
                    variant="destructive"
                    description="Pendientes de comprobante"
                  />
                </div>

                <div className="flex gap-2 flex-wrap text-xs bg-slate-50 p-3 rounded-lg border">
                  <span className="font-bold text-slate-500 uppercase flex items-center">📊 Prioridades:</span>
                  {[5, 4, 3, 2, 1].map(p => prioridadStats[p] ? (
                    <Badge key={p} className={cn("px-2 py-0.5", getPriorityBadge(p).color)}>
                      {getPriorityBadge(p).emoji} P{p}: {prioridadStats[p]}
                    </Badge>
                  ) : null)}
                </div>
              </CardContent>
            </Card>
          )}

          {/* LISTA O DETALLE */}
          {selectedRecord ? (
            <div className="space-y-4">
              <Button onClick={() => setSelectedRecord(null)} variant="outline" className="mb-2">
                ← Volver a la lista
              </Button>
              {isLoadingDetail ? (
                <LoadingState title="Cargando chat..." message="Obteniendo mensajes..." />
              ) : customerData ? (
                <div className="grid grid-cols-1 gap-6">
                  {/* Detalles del Cliente */}
                  <Card className="border-2 border-blue-200 overflow-hidden shadow-md">
                    <div className={cn("px-4 py-2 text-white font-bold text-sm bg-blue-600 flex justify-between")}>
                      <span>EXPEDIENTE DEL CLIENTE</span>
                      <span>#{customerData.customer.Cedula}</span>
                    </div>
                    <CardContent className="p-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Cliente</p>
                          <p className="font-bold text-lg leading-tight">{customerData.customer.Cliente}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Contacto</p>
                          <p className="font-medium flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> {customerData.customer.Celular}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Deuda Pendiente</p>
                          <p className="font-bold text-red-600 text-lg">${customerData.customer.SaldoVencido?.toFixed(2) || "0.00"}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Estado Recibo</p>
                          <Badge className={cn(customerData.customer.ComprobanteEnviado === "SI" ? "bg-green-500" : "bg-orange-500")}>
                            {customerData.customer.ComprobanteEnviado === "SI" ? "ENVIADO" : "PENDIENTE"}
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Historial de Chat */}
                  <Card className="border-2 border-blue-200 shadow-lg">
                    <CardHeader className="border-b bg-slate-50/50">
                      <div className="flex justify-between items-center">
                        <CardTitle className="flex items-center gap-2">
                          <MessageSquare className="w-5 h-5 text-blue-500" />
                          Chat de WhatsApp
                        </CardTitle>
                        <Button
                          onClick={() => {
                            const url = `${import.meta.env.VITE_CHATWOOT_API_URL}/app/accounts/${import.meta.env.VITE_CHATWOOT_ACCOUNT_ID}/conversations/${customerData.customer.conversation_id}`;
                            window.open(url, '_blank');
                          }}
                          className="bg-[#1f93ff] hover:bg-blue-700"
                        >
                          <MessageCircle className="w-4 h-4 mr-2" /> Abrir en Chatwoot
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4">
                      <ScrollArea className="h-[550px] pr-4">
                        <div className="space-y-4 py-4">
                          {customerData.conversations.mensajes.map((msg: any, i: number) => {
                            const text = parseMessage(msg);
                            if (!text) return null;
                            const isBot = msg.rol === "BOT";
                            return (
                              <div key={i} className={cn("flex w-full", isBot ? "justify-end" : "justify-start")}>
                                <div className={cn("max-w-[80%] rounded-2xl p-4 shadow-sm",
                                  isBot ? "bg-blue-600 text-white rounded-tr-none" : "bg-slate-100 text-slate-800 rounded-tl-none")}>
                                  <p className="text-[10px] font-bold mb-1 opacity-70 uppercase">{isBot ? "Bot Point" : customerData.customer.Cliente}</p>
                                  <div className="text-sm whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: text }} />
                                  <p className="text-[9px] mt-2 opacity-60 text-right">{new Date(msg.fecha_iso).toLocaleString()}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </div>
              ) : null}
            </div>
          ) : (
            <ScrollArea className="h-[600px]">
              <div className="space-y-3 pb-8">
                {filteredUniqueRecords.length > 0 ? (
                  filteredUniqueRecords.map((r) => {
                    const p = calculatePriority(r);
                    const b = getPriorityBadge(p.prioridad);
                    return (
                      <div
                        key={r.idCompra}
                        onClick={() => setSelectedRecord(r)}
                        className="p-4 border-2 border-slate-100 rounded-xl hover:border-blue-300 hover:bg-blue-50/20 cursor-pointer transition-all flex justify-between items-center bg-white shadow-sm"
                      >
                        <div className="space-y-2 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-slate-800 uppercase tracking-tight">{r.Cliente}</p>
                            <Badge variant="outline" className="text-[10px] h-5">Conv #{r.conversation_id}</Badge>
                            <Badge className={cn("text-[10px] h-5 font-bold", b.color)}>{b.emoji} {b.label}</Badge>
                          </div>
                          <div className="flex gap-4 text-xs text-muted-foreground font-medium">
                            <span className="flex items-center gap-1"><User className="w-3 h-3" /> {r.Cedula}</span>
                            <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {r.Celular}</span>
                            <span className="flex items-center gap-1"><ShoppingBag className="w-3 h-3" /> Compra {r.idCompra}</span>
                          </div>
                          {r.SaldoVencido && r.SaldoVencido > 0 && (
                            <Badge variant="secondary" className="bg-red-50 text-red-700 border-red-100 font-bold">
                              <DollarSign className="w-3 h-3 mr-1" /> Saldo: ${r.SaldoVencido.toFixed(2)}
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          {r.ComprobanteEnviado === "SI" && <Badge className="bg-green-100 text-green-700 border-green-200">✅ RECIBO</Badge>}
                          <Button size="sm" variant="outline" className="rounded-full text-[10px] h-7 px-3 border-orange-200 text-orange-600 hover:bg-orange-50">Llamar</Button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-20 bg-slate-50 rounded-xl border-2 border-dashed">
                    <Search className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                    <p className="text-slate-500 font-medium">Sincronización completa: Ningún cliente coincide con los filtros</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </>
      )}
    </div>
  );
};

export default ConversationHistoryTab;
