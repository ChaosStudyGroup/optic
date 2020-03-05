package com.useoptic.diff

import com.useoptic.contexts.requests.Commands._
import com.useoptic.contexts.requests._
import com.useoptic.contexts.rfc.RfcState
import com.useoptic.contexts.shapes.ShapesState
import com.useoptic.diff.ShapeDiffer.ShapeDiffResult
import io.circe._
import io.circe.syntax._
import com.useoptic.diff.query.{JvmQueryStringParser, QueryStringDiffer, QueryStringParser}
import com.useoptic.types.capture._

import scala.scalajs.js.annotation.{JSExport, JSExportAll}

@JSExport
case class ApiRequest(url: String, method: String, queryString: String, contentType: String, body: Option[Json] = None)

@JSExport
case class ApiResponse(statusCode: Int, contentType: String, body: Option[Json] = None)

@JSExport
@JSExportAll
case class ApiInteraction(apiRequest: ApiRequest, apiResponse: ApiResponse) {
  def stringToArbitraryData(s: String): ArbitraryData = {
    ArbitraryData(
      None,
      None,
      Some(s)
    )
  }

  def toHttpInteraction(): HttpInteraction = {
    HttpInteraction(
      "uuid",
      Request(
        "some.host",
        apiRequest.method,
        apiRequest.url,
        stringToArbitraryData(apiRequest.queryString),
        ArbitraryData(None, None, None),
        body(apiRequest.contentType, apiRequest.body)
      ),
      Response(
        apiResponse.statusCode,
        ArbitraryData(None, None, None),
        body(apiResponse.contentType, apiResponse.body)
      ),
      Vector()
    )
  }

  def body(contentType: String, body: Option[Json]): Body = {
    body match {
      case Some(value) => Body(Some(contentType), ArbitraryData(None, Some(value.noSpaces), None))
      case None => Body(None, ArbitraryData(None, None, None))
    }
  }
}


object PluginRegistryUtilities {
  def defaultPluginRegistry(shapesState: ShapesState) = {
    val parser = new JvmQueryStringParser(JsonObject(("f1", JsonNumber.fromIntegralStringUnsafe("1").asJson)).asJson)
    val differ = new QueryStringDiffer(shapesState, parser)
    PluginRegistry(differ)
  }
}

@JSExport
@JSExportAll
case class PluginRegistry(queryStringDiffer: QueryStringDiffer)

@JSExport
@JSExportAll
object RequestDiffer {

  @JSExportAll
  sealed trait RequestDiffResult

  case class UnmatchedUrl(interaction: ApiInteraction) extends RequestDiffResult

  case class UnmatchedHttpMethod(pathId: PathComponentId, method: String, interaction: ApiInteraction) extends RequestDiffResult

  case class UnmatchedHttpStatusCode(requestId: RequestId, statusCode: Int, interaction: ApiInteraction) extends RequestDiffResult

  case class UnmatchedResponseContentType(responseId: ResponseId, contentType: String, previousContentType: String, statusCode: Int) extends RequestDiffResult

  case class UnmatchedResponseBodyShape(responseId: ResponseId, contentType: String, responseStatusCode: Int, shapeDiff: ShapeDiffResult) extends RequestDiffResult

  case class UnmatchedRequestBodyShape(requestId: RequestId, contentType: String, shapeDiff: ShapeDiffResult) extends RequestDiffResult

  case class UnmatchedRequestContentType(requestId: RequestId, contentType: String, previousContentType: String) extends RequestDiffResult

  case class UnmatchedQueryParameterShape(requestId: RequestId, parameterId: RequestParameterId, shapeDiff: ShapeDiffResult, actual: Json) extends RequestDiffResult

  case class PipelineItem[T](item: Option[T], results: Iterator[RequestDiffResult])

  def compare(interaction: ApiInteraction, spec: RfcState, plugins: PluginRegistry): Iterator[RequestDiffResult] = {
    compare(ApiInteractionLike.fromApiInteraction(interaction), spec, plugins)
  }

  def compare(interaction: ApiInteractionLike, spec: RfcState, plugins: PluginRegistry): Iterator[RequestDiffResult] = {
    val pathPipeline = pathDiff(interaction, spec)
    pathPipeline.item match {
      case None => pathPipeline.results
      case Some(pathId) => {
        val requestPipeline = requestDiff(interaction, spec, pathId)
        requestPipeline.item match {
          case None => pathPipeline.results ++ requestPipeline.results
          case Some(request) => {
            val queryParameterPipeline = queryParameterDiff(interaction, spec, plugins, request)
            val responsePipeline = responseDiff(interaction, spec, request.requestId)
            queryParameterPipeline.results ++ requestPipeline.results ++ responsePipeline.results
          }
        }
      }
    }
  }

  def pathDiff(interaction: ApiInteractionLike, spec: RfcState): PipelineItem[PathComponentId] = {
    val matchedPath = Utilities.resolvePath(interaction.request.url, spec.requestsState.pathComponents)

    if (matchedPath.isEmpty) {
      return PipelineItem(None, Iterator(UnmatchedUrl(interaction.asApiInteraction)))
    }
    PipelineItem(matchedPath, Iterator())
  }

  def shouldTrustRequest(interaction: ApiInteractionLike): Boolean = {
    (200 until 400) contains interaction.response.statusCode
  }

  def queryParameterDiff(interaction: ApiInteractionLike, spec: RfcState, plugins: PluginRegistry, request: HttpRequest): PipelineItem[Any] = {
    if (shouldTrustRequest(interaction)) {
      val queryParameterWrapper = spec.requestsState.requestParameters
        .filter(x => {
          val (parameterId, parameter) = x
          //println(x)
          parameter.requestParameterDescriptor.pathId == request.requestDescriptor.pathComponentId && parameter.requestParameterDescriptor.httpMethod == request.requestDescriptor.httpMethod && parameter.requestParameterDescriptor.location == "query"
        })
        .values.headOption
      return queryParameterWrapper match {
        case Some(value) => {
          val diff = plugins.queryStringDiffer.diff(value, interaction.request.queryString)
          PipelineItem(None, diff)
        }
        case None => {
          PipelineItem(None, Iterator.empty)
        }
      }

    }
    PipelineItem(None, Iterator.empty)
  }

  def requestDiff(interaction: ApiInteractionLike, spec: RfcState, pathId: PathComponentId): PipelineItem[HttpRequest] = {
    val matchedOperation = spec.requestsState.requests.values
      .find(r => r.requestDescriptor.pathComponentId == pathId && r.requestDescriptor.httpMethod == interaction.request.method)

    if (matchedOperation.isEmpty) {
      return PipelineItem(None, Iterator(UnmatchedHttpMethod(pathId, interaction.request.method, interaction.asApiInteraction)))
    }

    val request = matchedOperation.get
    if (shouldTrustRequest(interaction)) {
      // request body
      val requestDiff: Option[Iterator[RequestDiffResult]] = request.requestDescriptor.bodyDescriptor match {
        case d: UnsetBodyDescriptor => {
          if (interaction.request.bodyShape.isEmpty) {
            None
          } else {
            Some(Iterator(UnmatchedRequestBodyShape(request.requestId, interaction.request.contentType, ShapeDiffer.UnsetShape(interaction.request.bodyShape.asJs))))
          }
        }
        case d: ShapedBodyDescriptor => {
          if (d.httpContentType == interaction.request.contentType) {
            val shape = spec.shapesState.shapes(d.shapeId)
            val shapeDiff = ShapeDiffer.diff(shape, interaction.request.bodyShape)(spec.shapesState)
            if (shapeDiff.isEmpty) {
              None
            } else {
              Some(shapeDiff.map(d => UnmatchedRequestBodyShape(request.requestId, interaction.request.contentType, d)))
            }
          } else {
            Some(Iterator(UnmatchedRequestContentType(request.requestId, interaction.request.contentType, d.httpContentType)))
          }
        }
      }
      if (requestDiff.isDefined) {
        return PipelineItem(None, requestDiff.get)
      }
    }
    PipelineItem(matchedOperation, Iterator.empty)
  }


  def responseDiff(interaction: ApiInteractionLike, spec: RfcState, requestId: RequestId): PipelineItem[HttpResponse] = {

    val request = spec.requestsState.requests(requestId)
    // check for matching response status
    val matchedResponse = spec.requestsState.responses.values
      .find(r => r.responseDescriptor.pathId == request.requestDescriptor.pathComponentId
        && r.responseDescriptor.httpMethod == request.requestDescriptor.httpMethod
        && r.responseDescriptor.httpStatusCode == interaction.response.statusCode
      )

    if (matchedResponse.isEmpty) {
      return PipelineItem(None, Iterator(UnmatchedHttpStatusCode(requestId, interaction.response.statusCode, interaction.asApiInteraction)))
    }

    val responseId = matchedResponse.get.responseId;
    val responseDiff: Option[Iterator[RequestDiffResult]] = matchedResponse.get.responseDescriptor.bodyDescriptor match {
      case d: UnsetBodyDescriptor => {
        if (interaction.response.bodyShape.isEmpty) {
          None
        } else {
          Some(
            Iterator(
              UnmatchedResponseBodyShape(
                responseId,
                interaction.response.contentType,
                interaction.response.statusCode,
                ShapeDiffer.UnsetShape(interaction.response.bodyShape.asJs)
              )
            )
          )
        }
      }
      case d: ShapedBodyDescriptor => {
        if (d.httpContentType == interaction.response.contentType) {
          val shape = spec.shapesState.shapes(d.shapeId)
          val shapeDiff = ShapeDiffer.diff(shape, interaction.response.bodyShape)(spec.shapesState)
          if (shapeDiff.isEmpty) {
            None
          } else {
            Some(shapeDiff.map(d => UnmatchedResponseBodyShape(responseId, interaction.response.contentType, interaction.response.statusCode, d)))
          }
        } else {
          Some(Iterator(UnmatchedResponseContentType(matchedResponse.get.responseId, interaction.response.contentType, d.httpContentType, interaction.response.statusCode)))
        }
      }
    }

    if (responseDiff.isDefined) {
      return PipelineItem(matchedResponse, responseDiff.get)
    }

    PipelineItem(matchedResponse, Iterator.empty)
  }
}


