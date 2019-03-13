// Copyright 2017 The Oppia Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS-IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview Service to chunk a piece of text into smaller parts
 * to feed into SpeechSynthesis, because SpeechSynthesis always times
 * out after 200-300 characters.
 *
 * Code is adapted from:
 * https://gist.github.com/woollsta/2d146f13878a301b36d7
 *
 * Credits to Peter Woolley and Brett Zamir.
 */

oppia.factory('SpeechSynthesisChunkerService', [
  '$timeout', 'RTE_COMPONENT_SPECS', function($timeout, RTE_COMPONENT_SPECS) {
    // Max number of characters to fit into one chunk.
    var CHUNK_LENGTH = 160;

    var _speechSynthesis = window.speechSynthesis;

    var RTE_COMPONENT_NAMES = {};
    Object.keys(RTE_COMPONENT_SPECS).forEach(function(componentSpec) {
      RTE_COMPONENT_NAMES[componentSpec] =
        RTE_COMPONENT_SPECS[componentSpec].frontend_id;
    });

    // Punctuation marks that should result in an audible pause when playing
    // back autogenerated audio.
    var PUNCTUATION_MARKS_TO_END_CHUNKS = '.!?:;';
    // Punctuation marks that we don't want to influence the playing back of
    // autogenerated audio.
    var PUNCTUATION_MARKS_TO_IGNORE = '"';

    var cancelRequested = false;

    /**
     * Takes an utterance, and plays it in separate utterances each of at
     *    most 160 characters in length.
     * @param {SpeechSynthesisUtterance} utterance - The original utterance
     *    that contains the whole message to speak.
     * @param {Number} offset - An integer indicating what offset in the text
     *    to begin the next chunked utterance.
     * @param {requestCallback} - Callback that is activated when the last
     *    chunked utterance finishes playing.
     */
    var _speechUtteranceChunker = function(utterance, offset, callback) {
      var newUtterance;
      var text = (offset !== undefined ?
        utterance.text.substring(offset) : utterance.text);

      // This regex pattern finds the next string at most 160
      // characters in length that ends on a punctuation mark in
      // PUNCTUATION_MARKS_TO_END_CHUNKS.
      var delimitChunkRegex = new RegExp('^[\\s\\S]{' +
        Math.floor(CHUNK_LENGTH / 4) + ',' + CHUNK_LENGTH + '}[' +
        PUNCTUATION_MARKS_TO_END_CHUNKS + ']{1}|^[\\s\\S]{1,' +
        CHUNK_LENGTH + '}$|^[\\s\\S]{1,' + CHUNK_LENGTH + '} ');
      var chunkArray = text.match(delimitChunkRegex);

      if (chunkArray === null ||
          chunkArray[0] === undefined ||
          chunkArray[0].length <= 2) {
        // Call once all text has been spoken.
        if (callback !== undefined) {
          callback();
        }
        return;
      }
      var chunk = chunkArray[0];
      newUtterance = new SpeechSynthesisUtterance(chunk);

      // Copy properties from the current utterance to the next utterance,
      // excluding the text being spoken.
      for (var property in utterance) {
        if (property !== 'text') {
          newUtterance[property] = utterance[property];
        }
      }
      newUtterance.onend = function() {
        if (cancelRequested) {
          cancelRequested = false;
          return;
        }
        offset += chunk.length;
        _speechUtteranceChunker(utterance, offset, callback);
      };

      // IMPORTANT!! Do not remove: Logging the object out fixes some onend
      // firing issues. Placing the speak invocation inside a callback
      // fixes ordering and onend issues.
      // eslint-disable-next-line no-console
      console.log(newUtterance);
      $timeout(function() {
        speechSynthesis.speak(newUtterance);
      }, 0);
    };

    var _convertToSpeakableText = function(html) {
      var elt = $('<div>' + html + '</div>');
      // Convert links into speakable text by extracting the readable value.
      elt.find('oppia-noninteractive-' + RTE_COMPONENT_NAMES.Link)
        .replaceWith(function() {
          if (this.attributes['text-with-value'] !== undefined) {
            return this.attributes['text-with-value'].textContent
              .replace(/&quot;/g, '');
          }
        });

      // Convert LaTeX to speakable text.
      elt.find('oppia-noninteractive-' + RTE_COMPONENT_NAMES.Math)
        .replaceWith(function() {
          if (this.attributes['raw_latex-with-value'] !== undefined) {
            return _formatLatexToSpeakableText(
              this.attributes['raw_latex-with-value'].textContent);
          }
        });

      html = elt.html();
      // Replace certain HTML elements with periods to indicate
      // pauses in speaking. Also, for some reason, there's a lot
      // of whitespace (like hundreds of characters) so we trim
      // it off to avoid blank chunks.
      html = html.replace(new RegExp('</li>', 'g'), '.').trim();
      // Strip away HTML tags.
      var tmp = $('<div></div>');
      tmp.html(html);
      var textToSpeakWithoutPauses = tmp.text();
      var textToSpeak = '';
      // Insert a space after punctuation marks to ensure that chunking will
      // end on the desired punctuation marks so that SpeechSynthesis will
      // pause more naturally. Remove any punctuation marks that have no
      // effect on speaking.
      for (var i = 0; i < textToSpeakWithoutPauses.length; i++) {
        if (PUNCTUATION_MARKS_TO_IGNORE.indexOf(
          textToSpeakWithoutPauses.charAt(i)) > -1) {
          continue;
        }
        textToSpeak += textToSpeakWithoutPauses.charAt(i);
        if (PUNCTUATION_MARKS_TO_END_CHUNKS.indexOf(
          textToSpeakWithoutPauses.charAt(i)) > -1) {
          textToSpeak += ' ';
        }
      }
      return textToSpeak;
    };

    var _formatLatexToSpeakableText = function(latex) {
      return latex
        .replace(/&quot;/g, '')
        .replace(/\\/g, '')
        .replace(/\s+/, ' ')
        // Separate consecutive characters with spaces so that 'ab'
        // is pronounced 'a' followed by 'b'.
        .split('').join(' ')
        .replace(/\s*(\d+)\s*/g, '$1')
        // Replace dashes with 'minus'.
        .replace(/-/g, ' minus ')
        // Ensure that 'x^2' is pronounced 'x squared' rather than
        // 'x caret 2'.
        .replace(/\s*\^\s*/g, '^')
        // Speak 'x^y' as 'x to the power of y' unless the exponent is two or
        // three, in which case Web Speech will read 'squared' and 'cubed'
        // respectively.
        .replace(/(.*)\^(\{*[0-9].+|[0-14-9]\}*)/g, '$1 to the power of $2')
        // Handle simple fractions.
        .replace(/f\sr\sa\sc\s\{\s*(.+)\s*\}\s\{\s*(.+)\s*\}/g,
          '$1/$2')
        // If a fraction contains a variable, then say (numerator) 'over'
        // (denominator).
        .replace(/(\d*\D+)\/(\d*\D*)|(\d*\D*)\/(\d*\D+)/g, '$1 over $2')
        // Handle basic trigonometric functions.
        .replace(/t\sa\sn/g, 'the tangent of')
        .replace(/s\si\sn/g, 'the sine of')
        .replace(/c\so\ss/g, 'the cosine of')
        // Handle square roots.
        .replace(/s\sq\sr\st\s\{\s*(.+)\s*\}/g, 'the square root of $1')
        // Remove brackets.
        .replace(/[\}\{]/g, '')
        // Replace multiple spaces with single space.
        .replace(/\s\s+/g, ' ')
        .trim();
    };

    return {
      speak: function(utterance, callback) {
        cancelRequested = false;
        _speechUtteranceChunker(utterance, 0, callback);
      },
      cancel: function() {
        cancelRequested = true;
        if (_speechSynthesis) {
          _speechSynthesis.cancel();
        }
      },
      convertToSpeakableText: function(html) {
        return _convertToSpeakableText(html);
      },
      formatLatexToSpeakableText: function(latex) {
        return _formatLatexToSpeakableText(latex);
      }
    };
  }
]);
