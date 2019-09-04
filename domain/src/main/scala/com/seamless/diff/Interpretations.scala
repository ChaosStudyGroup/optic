package com.seamless.diff

import com.seamless.contexts.requests.Commands.{RequestId, SetRequestBodyShape, SetResponseBodyShape, ShapedBodyDescriptor}
import com.seamless.contexts.requests.{Commands, RequestsServiceHelper}
import com.seamless.contexts.rfc.Commands.RfcCommand
import com.seamless.contexts.shapes.Commands.{AddField, AddShape, FieldId, FieldShapeFromShape, SetFieldShape}
import com.seamless.contexts.shapes.{ShapesHelper, ShapesState}
import com.seamless.diff.initial.{NameShapeRequest, ShapeBuilder, ShapeResolver}
import io.circe.Json

import scala.scalajs.js.annotation.{JSExport, JSExportAll}

@JSExportAll
case class DiffInterpretation(title: String,
                              description: String,
                              commands: Seq[RfcCommand],
                              affectedIds: Seq[String],
                              nameRequests: Seq[NameShapeRequest] = Seq.empty,
                              example: Json = null) {
  def exampleJs = {
    import io.circe.scalajs.convertJsonToJs
    if (example != null) convertJsonToJs(example) else null
  }
}

object Interpretations {

  def AddRequest(method: String, pathId: String) = {
    val id = RequestsServiceHelper.newRequestId()
    val commands = Seq(
      Commands.AddRequest(id, pathId, method)
    )
    DiffInterpretation(
      "New Operation",
      s"Optic observed a ${method.toUpperCase} operation for this path",
      commands,
      affectedIds = Seq(id)
    )
  }

  def AddResponse(statusCode: Int, requestId: String) = {
    val id = RequestsServiceHelper.newResponseId()
    val commands = Seq(
      Commands.AddResponse(id, requestId, statusCode)
    )
    DiffInterpretation(
      s"New Response",
      s"A ${statusCode} response was observed.",
      commands,
      affectedIds = Seq(id)
    )
  }

  def RequireManualIntervention(message: String, affectedIds: Seq[String]) = {
    DiffInterpretation(
      "Manual Intervention Required",
      message,
      Seq.empty,
      affectedIds
    )
  }

  def ChangeRequestContentType(requestId: RequestId, newContentType: String, oldContentType: String)(implicit shapesState: ShapesState) = {
    val commands = Seq(
      Commands.SetRequestContentType(requestId, newContentType)
    )

    DiffInterpretation(
      s"Request Content-Type Changed",
      s"The content type of the request was changed from\n<b>${oldContentType}</b> -> <b>${newContentType}</b>",
      commands,
      affectedIds = Seq(requestId, requestId + ".content_type")
    )
  }

  def ChangeResponseContentType(responseStatusCode: Int, responseId: String, newContentType: String, oldContentType: String) = {
    val commands = Seq(
      Commands.SetResponseContentType(responseId, newContentType)
    )

    DiffInterpretation(
      s"Response Content-Type Changed",
      s"The content type of the ${responseStatusCode} response was changed from\n<b>${oldContentType}</b> -> <b>${newContentType}</b>",
      commands,
      affectedIds = Seq(responseId, responseId + ".content_type")
    )
  }

  def AddInitialRequestBodyShape(actual: Json, requestId: RequestId, contentType: String)(implicit shapesState: ShapesState) = {
    val shape = new ShapeBuilder(actual).run
    val inlineShapeId = shape.rootShapeId
    val wrapperId = ShapesHelper.newShapeId()

    val name = shapesState.concepts.collectFirst {
      case (id, concept) if id == inlineShapeId => concept.descriptor.name
    }

    val desc = if (name.isDefined) s"Optic observed a request body of type <b>${name.get}</b>" else "Optic observed a request body."

    val commands = shape.commands ++ Seq(
      AddShape(wrapperId, inlineShapeId, ""),
      SetRequestBodyShape(requestId, ShapedBodyDescriptor(contentType, wrapperId, isRemoved = false))
    )

    DiffInterpretation(
      s"Request Body Observed",
      desc,
      commands,
      affectedIds = Seq(wrapperId),
      shape.nameRequests,
      example = actual
    )
  }

  def AddFieldToRequestShape(key: String, raw: Json, parentShapeId: String, requestId: RequestId)(implicit shapesState: ShapesState) = {
    val fieldId = ShapesHelper.newFieldId()

    val shapeId = ShapeResolver.resolveJsonToShapeId(raw).getOrElse("$any")

    val commands = Seq(AddField(fieldId, parentShapeId, key, FieldShapeFromShape(fieldId, shapeId)))

    val parentConceptName = shapesState.concepts.collectFirst {
      case (id, concept) if id == parentShapeId => concept.descriptor.name
    }

    val desc = if (parentConceptName.isDefined) {
      s"A new field '${key}' was observed in <b>${parentConceptName.get}</b>",
    } else {
      s"A new field '${key}' was observed in the request body.",
    }

    DiffInterpretation(
      s"A Field was Added",
      //@todo change copy based on if it's a concept or not
      desc,
      commands,
      affectedIds = Seq(fieldId)
    )
  }

  def ChangeFieldInRequestShape(key: String, fieldId: FieldId, newShapeId: String, requestId: RequestId) = {
    val commands = Seq(
      SetFieldShape(FieldShapeFromShape(fieldId, newShapeId))
    )

    DiffInterpretation(
      s"A field's type was changed",
      //@todo change copy based on if it's a concept or not
      s"The type of '${key}' was changed in the request.",
      commands,
      affectedIds = Seq(fieldId)
    )
  }

  def AddInitialResponseBodyShape(actual: Json, responseStatusCode: Int, responseId: String, contentType: String)(implicit shapesState: ShapesState) = {
    val shape = new ShapeBuilder(actual).run
    val inlineShapeId = shape.rootShapeId
    val wrapperId = ShapesHelper.newShapeId()

    val name = shapesState.concepts.collectFirst {
      case (id, concept) if id == inlineShapeId => concept.descriptor.name
    }

    val desc = if (name.isDefined) s"Optic observed a ${responseStatusCode} response body of type <b>${name.get}</b>." else s"Optic observed a ${responseStatusCode} response body."

    val commands = shape.commands ++ Seq(
      AddShape(wrapperId, inlineShapeId, ""),
      SetResponseBodyShape(responseId, ShapedBodyDescriptor(contentType, wrapperId, isRemoved = false))
    )

    DiffInterpretation(
      s"Response Body Observed",
      desc,
      commands,
      affectedIds = Seq(wrapperId),
      shape.nameRequests,
      example = actual
    )
  }

  def AddFieldToResponseShape(key: String, raw: Json, parentShapeId: String, responseStatusCode: Int, responseId: String)(implicit shapesState: ShapesState) = {
    val fieldId = ShapesHelper.newFieldId()

    println("RESOLVING "+ raw.noSpaces)
    val shapeId = ShapeResolver.resolveJsonToShapeId(raw).getOrElse("$any")
    println("RESULT "+ shapeId)

    val commands = Seq(AddField(fieldId, parentShapeId, key, FieldShapeFromShape(fieldId, shapeId)))

    val parentConceptName = shapesState.concepts.collectFirst {
      case (id, concept) if id == parentShapeId => concept.descriptor.name
    }

    val desc = if (parentConceptName.isDefined) {
      s"A new field '${key}' was observed in <b>${parentConceptName.get}</b>",
    } else {
      s"A new field '${key}' was observed in the ${responseStatusCode} response body.",
    }


    DiffInterpretation(
      s"A Field was Added",
      desc,
      commands,
      affectedIds = Seq(fieldId)
    )

  }

  def ChangeFieldInResponseShape(key: String, fieldId: String, newShapeId: String, responseStatusCode: Int) = {

    val commands = Seq(
      SetFieldShape(FieldShapeFromShape(fieldId, newShapeId))
    )

    DiffInterpretation(
      s"A field's type was changed",
      //@todo change copy based on if it's a concept or not
      s"The type of '${key}' was changed.",
      commands,
      affectedIds = Seq(fieldId)
    )

  }

}