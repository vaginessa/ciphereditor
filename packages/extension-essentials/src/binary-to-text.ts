
import { Contribution, OperationExecuteExport, OperationIssue } from '@ciphereditor/types'
import { hasUniqueElements } from './lib/array'
import { lcm } from './lib/math'
import { stringFromUnicodeCodePoints, stringToUnicodeCodePoints } from './lib/string'
import { bufferToString, stringToBuffer, transformUnitSize } from './lib/binary'

const contribution: Contribution = {
  type: 'operation',
  name: '@ciphereditor/extension-essentials/binary-to-text',
  label: 'Binary to text encoding',
  description: 'Operation for commonly used base64, base32, base16, hex, and binary encoding schemes.',
  url: 'https://ciphereditor.com/operations/binary-to-text',
  keywords: ['base64', 'base32', 'base16', 'binary'],
  controls: [
    {
      name: 'data',
      initialValue: 'The quick brown fox jumps over the lazy dog.',
      types: ['bytes', 'text']
    },
    {
      name: 'alphabet',
      initialValue: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
      types: ['text'],
      choices: [
        {
          value: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
          label: 'base64'
        },
        {
          value: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
          label: 'base64url'
        },
        {
          value: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
          label: 'base32'
        },
        {
          value: '0123456789ABCDEFGHIJKLMNOPQRSTUV',
          label: 'base32hex'
        },
        {
          value: 'ybndrfg8ejkmcpqxot1uwisza345h769',
          label: 'z-base-32'
        },
        {
          value: '0123456789ABCDEF',
          label: 'base16, hex'
        },
        {
          value: '0123',
          label: 'base4, quaternary'
        },
        {
          value: '01',
          label: 'base2, binary'
        }
      ],
      enforceChoices: false
    },
    {
      name: 'padding',
      initialValue: '=',
      types: ['text'],
      choices: [
        { value: '', label: 'None' },
        { value: '=', label: 'Equals sign (=)' }
      ],
      enforceChoices: false
    },
    {
      name: 'encodedData',
      initialValue: 'VGhlIHF1aWNrIGJyb3duIGZveCBqdW1wcyBvdmVyIHRoZSBsYXp5IGRvZy4=',
      types: ['text'],
      order: 1000
    }
  ]
}

const execute: OperationExecuteExport = (request) => {
  const { values, controlPriorities } = request

  // Read and validate alphabet
  const alphabetString = values.alphabet.data as string
  const alphabet = stringToUnicodeCodePoints(alphabetString)
  if (alphabet.length <= 1) {
    return {
      type: 'error',
      controlName: 'alphabet',
      message: 'The alphabet must have a size of 2 characters or more'
    }
  }
  if (Math.log2(alphabet.length) % 1 !== 0) {
    return {
      type: 'error',
      controlName: 'alphabet',
      message: 'As of now only alphabets with a size being a power of two (2, 4, 8, 16, …) are supported'
    }
  }
  if (!hasUniqueElements(alphabet)) {
    return {
      type: 'error',
      controlName: 'alphabet',
      message: 'The alphabet must not contain duplicate characters'
    }
  }

  // Read and validate padding symbol
  const paddingSymbolString = values.padding.data as string
  const paddingSymbolCodePoints = stringToUnicodeCodePoints(paddingSymbolString)
  if (paddingSymbolCodePoints.length > 1) {
    return {
      type: 'error',
      controlName: 'paddingSymbol',
      message: 'No more than one padding symbol is allowed'
    }
  }
  const paddingSymbolCodePoint = paddingSymbolCodePoints.at(0)
  if (paddingSymbolCodePoint !== undefined && alphabet.includes(paddingSymbolCodePoint)) {
    return {
      type: 'error',
      controlName: 'paddingSymbol',
      message: 'The padding symbol must not be part of the alphabet'
    }
  }

  // Infer in and out unit sizes from alphabet
  const n = alphabet.length
  const inUnitSize = 8
  const outUnitSize = Math.floor(Math.log2(n))

  const encode = controlPriorities.indexOf('data') < controlPriorities.indexOf('encodedData')
  if (encode) {
    // Read data
    const units = Array.from(new Uint8Array(
      values.data.type === 'bytes'
        ? values.data.data
        : stringToBuffer(values.data.data as string)
    ))

    // Transform unit size (encode)
    const encodedUnits = transformUnitSize(units, inUnitSize, outUnitSize)
    const encodedCodePoints = encodedUnits.map(unit => alphabet[unit])

    // Apply padding
    if (paddingSymbolCodePoint !== undefined) {
      const padMultiple = lcm(inUnitSize, outUnitSize) / outUnitSize
      const paddedLength = Math.ceil(encodedCodePoints.length / padMultiple) * padMultiple
      while (encodedCodePoints.length < paddedLength) {
        encodedCodePoints.push(paddingSymbolCodePoint)
      }
    }

    const encodedData = stringFromUnicodeCodePoints(encodedCodePoints)
    return { changes: [{ name: 'encodedData', value: encodedData }] }
  } else {
    // Infer case sensitivity from alphabet
    const lowercaseAlphabet = stringToUnicodeCodePoints(alphabetString.toLowerCase())
    const caseSensitivity = !hasUniqueElements(lowercaseAlphabet)
    const decodeAlphabet = caseSensitivity ? alphabet : lowercaseAlphabet

    // Create reverse map
    const reverseMap = new Map<number, number>()
    for (let i = 0; i < decodeAlphabet.length; i++) {
      reverseMap.set(decodeAlphabet[i], i)
    }

    // Read encoded data
    const encodedDataString = values.encodedData.data as string
    const encodedCodePoints = stringToUnicodeCodePoints(
      caseSensitivity ? encodedDataString : encodedDataString.toLowerCase())

    // Map encoded code points to encoded units
    let encounteredForeignCharacters = false
    let j = 0
    let encodedUnits = new Array(encodedCodePoints.length)
    for (const encodedCodePoint of encodedCodePoints) {
      const encodedUnit = reverseMap.get(encodedCodePoint)
      if (encodedUnit !== undefined) {
        encodedUnits[j++] = encodedUnit
      } else if (encodedCodePoint !== paddingSymbolCodePoint) {
        encounteredForeignCharacters = true
      }
    }
    encodedUnits = encodedUnits.slice(0, j)

    // Transform unit size (decode)
    const units = transformUnitSize(encodedUnits, outUnitSize, inUnitSize)
    const buffer = Uint8Array.from(units).buffer

    // Add an issue if foreign characters were encountered
    const issues: OperationIssue[] = []
    if (encounteredForeignCharacters) {
      issues.push({
        type: 'warn',
        controlName: 'encodedData',
        message: 'The value contains characters that are not part of the alphabet and thus get ignored'
      })
    }

    // If the original data is text-based, try to keep it that way
    if (values.data.type === 'text') {
      const string = bufferToString(buffer)
      if (string !== undefined) {
        return {
          changes: [{ name: 'data', value: string }],
          issues
        }
      }
    }

    // Use binary-based original data
    return {
      changes: [{ name: 'data', value: buffer }],
      issues
    }
  }
}

export default {
  contribution,
  body: {
    execute
  }
}
