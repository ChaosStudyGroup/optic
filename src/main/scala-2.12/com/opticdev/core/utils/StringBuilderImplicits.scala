package com.opticdev.core.utils

object StringBuilderImplicits {
  implicit class StringBuilderWithRangeUpdate(stringBuilder: scala.collection.mutable.StringBuilder) {
    def updateRange(range: Range, contents: String) = {

      def validRange(int: Int) = int >= 0 && int < stringBuilder.length

      if (!validRange(range.start) || !validRange(range.end) || range.end < range.start) {
        throw new Error("Invalid range "+ range)
      }

      range.reverse.foreach(i=> {
        val charOption = contents.lift(range.indexOf(i))
        if (charOption.isDefined) {
          stringBuilder.update(i, charOption.get)
        } else {
          stringBuilder.deleteCharAt(i)
        }
      })

      if (contents.length > range.size) {
        val endOfContents = contents.substring(range.size)
        val remainingRange = Range(range.end, range.end + contents.length - range.size)

        remainingRange.foreach(i=> stringBuilder.insert(i, endOfContents(remainingRange.indexOf(i))))
      }

      stringBuilder
    }
  }
}