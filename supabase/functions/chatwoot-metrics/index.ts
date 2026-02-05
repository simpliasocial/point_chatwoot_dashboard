// Edge function to fetch Chatwoot metrics with date filtering
// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ChatwootConversation {
  id: number
  created_at: number
  last_activity_at: number
  meta: any
  messages: any[]
}

interface ChatwootResponse {
  data: {
    meta: {
      mine_count: number
      assigned_count: number
      unassigned_count: number
      all_count: number
    }
    payload: ChatwootConversation[]
  }
}

interface MetricsResult {
  total_conversaciones_filtradas: number
  fecha_inicio: string
  fecha_fin: string
  label: string
  conversaciones: ChatwootConversation[]
}

/**
 * Convierte una fecha en formato YYYY-MM-DD de zona horaria Ecuador (UTC-5) a timestamp Unix UTC
 * @param fecha - Fecha en formato YYYY-MM-DD
 * @param esFinDeDia - Si es true, usa 23:59:59, si es false usa 00:00:00
 * @returns Timestamp Unix en segundos (UTC)
 */
function convertirFechaEcuadorATimestamp(fecha: string, esFinDeDia: boolean = false): number {
  // Ecuador está en UTC-5
  const offset = -5 * 60 * 60 * 1000; // -5 horas en milisegundos

  const fechaLocal = new Date(fecha + (esFinDeDia ? 'T23:59:59' : 'T00:00:00'));
  const timestampUTC = fechaLocal.getTime() - offset;

  return Math.floor(timestampUTC / 1000);
}

/**
 * Obtiene todas las conversaciones de Chatwoot para una etiqueta específica con paginación completa
 * @param label - La etiqueta a buscar
 * @param baseUrl - URL base de Chatwoot
 * @param accountId - ID de cuenta de Chatwoot
 * @param apiToken - Token de API de Chatwoot
 * @returns Array de conversaciones
 */
async function obtenerConversacionesPorEtiqueta(
  label: string,
  baseUrl: string,
  accountId: string,
  apiToken: string
): Promise<ChatwootConversation[]> {
  let allConversations: ChatwootConversation[] = []
  let currentPage = 1
  let hasMorePages = true
  let consecutiveEmptyPages = 0
  const maxConsecutiveEmptyPages = 3 // Máximo de páginas vacías consecutivas antes de parar

  console.log(`🔍 Iniciando obtención COMPLETA de conversaciones para etiqueta: ${label}`)

  while (hasMorePages) {
    const url = `${baseUrl}/api/v1/accounts/${accountId}/conversations?labels[]=${encodeURIComponent(label)}&status=all&page=${currentPage}`

    console.log(`📄 Consultando página ${currentPage} para ${label}`)

    try {
      const response = await fetch(url, {
        headers: {
          'api_access_token': apiToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        method: 'GET'
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`❌ Error HTTP ${response.status} en página ${currentPage} para label ${label}:`, response.statusText, errorText)

        // Si es un error 404 o similar, probablemente no hay más páginas
        if (response.status === 404 || response.status === 422) {
          console.log(`🛑 Página ${currentPage} no encontrada para ${label}, terminando paginación`)
          hasMorePages = false
        } else {
          // Para otros errores, intentar la siguiente página
          currentPage++
          consecutiveEmptyPages++
          if (consecutiveEmptyPages >= maxConsecutiveEmptyPages) {
            console.log(`🛑 Demasiados errores consecutivos para ${label}, terminando`)
            hasMorePages = false
          }
        }
        continue
      }

      let data: ChatwootResponse
      try {
        const rawData = await response.json()
        console.log(`📦 Respuesta raw de Chatwoot para ${label} página ${currentPage}:`, JSON.stringify(rawData).substring(0, 200))
        data = rawData as ChatwootResponse
      } catch (parseError) {
        console.error(`❌ Error parseando JSON para ${label} página ${currentPage}:`, parseError)
        currentPage++
        consecutiveEmptyPages++
        if (consecutiveEmptyPages >= maxConsecutiveEmptyPages) {
          hasMorePages = false
        }
        continue
      }

      const conversations = data.data?.payload || []
      const meta = data.data?.meta || { mine_count: 0, assigned_count: 0, unassigned_count: 0, all_count: 0 }

      console.log(`📊 Página ${currentPage} para ${label}: ${conversations.length} conversaciones encontradas`)
      console.log(`📈 Meta información:`, {
        mine_count: meta.mine_count,
        assigned_count: meta.assigned_count,
        unassigned_count: meta.unassigned_count,
        all_count: meta.all_count
      })

      // Si no hay conversaciones en esta página
      if (conversations.length === 0) {
        consecutiveEmptyPages++
        console.log(`📭 Página ${currentPage} vacía para ${label} (${consecutiveEmptyPages}/${maxConsecutiveEmptyPages} páginas vacías consecutivas)`)

        // Si hemos tenido varias páginas vacías consecutivas, probablemente no hay más datos
        if (consecutiveEmptyPages >= maxConsecutiveEmptyPages) {
          console.log(`🏁 Terminando paginación para ${label}: ${maxConsecutiveEmptyPages} páginas vacías consecutivas`)
          hasMorePages = false
        } else {
          // Intentar la siguiente página por si acaso
          currentPage++
        }
      } else {
        // Resetear contador de páginas vacías ya que encontramos datos
        consecutiveEmptyPages = 0

        // Agregar conversaciones al array total
        allConversations = allConversations.concat(conversations)
        console.log(`✅ Agregadas ${conversations.length} conversaciones. Total acumulado para ${label}: ${allConversations.length}`)

        // Continuar con la siguiente página
        currentPage++
      }

      // Límite de seguridad para evitar bucles infinitos (aumentado para manejar más datos)
      if (currentPage > 500) {
        console.warn(`⚠️ Límite máximo de páginas alcanzado (500) para etiqueta ${label}`)
        hasMorePages = false
      }

    } catch (error) {
      console.error(`💥 Error al obtener página ${currentPage} para label ${label}:`, error)
      consecutiveEmptyPages++

      if (consecutiveEmptyPages >= maxConsecutiveEmptyPages) {
        console.log(`🛑 Demasiados errores consecutivos para ${label}, terminando`)
        hasMorePages = false
      } else {
        currentPage++
      }
    }

    // Pequeña pausa entre requests para evitar rate limiting
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  console.log(`🎯 TOTAL FINAL para etiqueta ${label}: ${allConversations.length} conversaciones obtenidas en ${currentPage - 1} páginas`)
  return allConversations
}

/**
 * Filtra conversaciones por rango de fechas usando zona horaria de Ecuador
 * @param conversaciones - Array de conversaciones
 * @param fechaInicio - Fecha inicio en formato YYYY-MM-DD
 * @param fechaFin - Fecha fin en formato YYYY-MM-DD
 * @param label - Etiqueta para logging
 * @returns Conversaciones filtradas
 */
function filtrarConversacionesPorFecha(
  conversaciones: ChatwootConversation[],
  fechaInicio: string,
  fechaFin: string,
  label: string
): ChatwootConversation[] {
  const timestampInicio = convertirFechaEcuadorATimestamp(fechaInicio, false)
  const timestampFin = convertirFechaEcuadorATimestamp(fechaFin, true)

  console.log(`🗓️ Filtrando ${label}:`)
  console.log(`   📅 ${fechaInicio} 00:00:00 Ecuador = ${timestampInicio} UTC (${new Date(timestampInicio * 1000).toISOString()})`)
  console.log(`   📅 ${fechaFin} 23:59:59 Ecuador = ${timestampFin} UTC (${new Date(timestampFin * 1000).toISOString()})`)
  console.log(`   📊 Total conversaciones antes del filtro: ${conversaciones.length}`)

  let dentroDelRango = 0
  let antesDelRango = 0
  let despuesDelRango = 0

  const filtradas = conversaciones.filter((conv) => {
    const createdAt = conv.created_at || 0
    const enRango = createdAt >= timestampInicio && createdAt <= timestampFin

    if (enRango) {
      dentroDelRango++
    } else if (createdAt < timestampInicio) {
      antesDelRango++
    } else {
      despuesDelRango++
    }

    return enRango
  })

  console.log(`📈 Resultados del filtro para ${label}:`)
  console.log(`   ✅ Dentro del rango: ${dentroDelRango}`)
  console.log(`   ⬅️ Antes del rango: ${antesDelRango}`)
  console.log(`   ➡️ Después del rango: ${despuesDelRango}`)
  console.log(`   🎯 Total filtradas: ${filtradas.length} de ${conversaciones.length}`)

  return filtradas
}

/**
 * Procesa métricas para una etiqueta específica
 */
async function procesarMetricasPorEtiqueta(
  label: string,
  fechaInicio: string,
  fechaFin: string,
  baseUrl: string,
  accountId: string,
  apiToken: string
): Promise<MetricsResult> {
  // 1. Obtener todas las conversaciones para esta etiqueta
  const todasLasConversaciones = await obtenerConversacionesPorEtiqueta(
    label,
    baseUrl,
    accountId,
    apiToken
  )

  // 2. Filtrar por rango de fechas
  const conversacionesFiltradas = filtrarConversacionesPorFecha(
    todasLasConversaciones,
    fechaInicio,
    fechaFin,
    label
  )

  // 3. Retornar resultado
  return {
    total_conversaciones_filtradas: conversacionesFiltradas.length,
    fecha_inicio: fechaInicio,
    fecha_fin: fechaFin,
    label: label,
    conversaciones: conversacionesFiltradas
  }
}

serve(async (req) => {
  try {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: corsHeaders
      })
    }

    const { type, date, dateFrom, dateTo } = await req.json()

    console.log('Parámetros de solicitud:', { type, date, dateFrom, dateTo })
    const CHATWOOT_BASE_URL = Deno.env.get('CHATWOOT_BASE_URL')
    const CHATWOOT_API_TOKEN = Deno.env.get('CHATWOOT_API_TOKEN')
    const CHATWOOT_ACCOUNT_ID = Deno.env.get('CHATWOOT_ACCOUNT_ID')

    if (!CHATWOOT_BASE_URL || !CHATWOOT_API_TOKEN || !CHATWOOT_ACCOUNT_ID) {
      console.error('❌ Variables de entorno faltantes:', {
        hasBaseUrl: !!CHATWOOT_BASE_URL,
        hasToken: !!CHATWOOT_API_TOKEN,
        hasAccountId: !!CHATWOOT_ACCOUNT_ID
      })
      return new Response(
        JSON.stringify({
          error: 'Configuración de Chatwoot faltante. Por favor configura las variables de entorno en Supabase.',
          details: {
            CHATWOOT_BASE_URL: !!CHATWOOT_BASE_URL,
            CHATWOOT_API_TOKEN: !!CHATWOOT_API_TOKEN,
            CHATWOOT_ACCOUNT_ID: !!CHATWOOT_ACCOUNT_ID
          }
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    console.log('Configuración Chatwoot:', {
      baseUrl: CHATWOOT_BASE_URL,
      accountId: CHATWOOT_ACCOUNT_ID,
      hasToken: !!CHATWOOT_API_TOKEN
    })    // Etiquetas que queremos analizar
    const labels = [
      'comprobante_enviado',
      'factura_enviada',
      'soporte',
      'cobrador',
      'devolucion_producto',
      'servicio_tecnico',
      'consulto_saldo',
      'resuelto',
      'pagado',
      'consulto_datos_transferencia',
      'no_registrado',
      'compromiso_pago',
      'numero_equivocado',
      'documento_enviado',
      'faltan_datos',
      'imagen_enviada',
      'pago_parcial',
      'quiero_pagar',
      'reactivacion_cobro',
      'recordatorio',
      'recordatorio_compromiso_pago',
      'recordatorio_diasmora_1',
      'recordatorio_diasmora_menos_3'
    ]

    const metrics: Record<string, number> = {}
    let fechaInicio: string
    let fechaFin: string

    // Determinar rango de fechas según el tipo de consulta
    if (type === 'day' && date) {
      fechaInicio = date
      fechaFin = date
    } else if (type === 'range' && dateFrom && dateTo) {
      fechaInicio = dateFrom
      fechaFin = dateTo
    } else {
      return new Response(
        JSON.stringify({ error: 'Parámetros de fecha inválidos' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    console.log(`🚀 Procesando métricas del ${fechaInicio} al ${fechaFin}`)

    // Procesar cada etiqueta
    for (const label of labels) {
      console.log(`\n🏷️ ===== PROCESANDO ETIQUETA: ${label.toUpperCase()} =====`)

      try {
        const tiempoInicio = Date.now()

        const resultado = await procesarMetricasPorEtiqueta(
          label,
          fechaInicio,
          fechaFin,
          CHATWOOT_BASE_URL,
          CHATWOOT_ACCOUNT_ID,
          CHATWOOT_API_TOKEN
        )

        const tiempoTotal = Date.now() - tiempoInicio

        metrics[label] = resultado.total_conversaciones_filtradas
        console.log(`✅ Métrica ${label}: ${resultado.total_conversaciones_filtradas} conversaciones (procesado en ${tiempoTotal}ms)`)

      } catch (error) {
        console.error(`❌ Error procesando etiqueta ${label}:`, error)
        metrics[label] = 0
      }
    }

    // Obtener total de conversaciones (sin filtro de etiqueta)
    try {
      console.log(`\n📊 ===== OBTENIENDO TOTAL GENERAL =====`)
      const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations?status=all&page=1`
      const response = await fetch(url, {
        headers: {
          'api_access_token': CHATWOOT_API_TOKEN,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        method: 'GET'
      })

      if (response.ok) {
        const data = await response.json()
        metrics['total_conversations'] = data.data?.meta?.all_count || 0
        console.log(`✅ Total conversaciones: ${metrics['total_conversations']}`)
      } else {
        console.error('Error obteniendo total general:', await response.text())
        metrics['total_conversations'] = 0
      }
    } catch (error) {
      console.error('Error obteniendo total general:', error)
      metrics['total_conversations'] = 0
    }

    console.log(`\n🎯 ===== MÉTRICAS FINALES =====`)
    for (const [label, count] of Object.entries(metrics)) {
      console.log(`📊 ${label}: ${count} conversaciones`)
    }
    console.log(`Total general: ${Object.values(metrics).reduce((a, b) => a + b, 0)} conversaciones`)

    return new Response(
      JSON.stringify(metrics),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    // Este catch captura CUALQUIER error, incluyendo errores de parsing JSON
    console.error('❌ Error crítico en función edge:', error)
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido'
    const errorStack = error instanceof Error ? error.stack : ''

    return new Response(
      JSON.stringify({
        error: errorMessage,
        stack: errorStack,
        message: 'Error al procesar la solicitud. Verifica los logs de Supabase para más detalles.'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
