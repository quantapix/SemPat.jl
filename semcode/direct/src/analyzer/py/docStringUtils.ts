export function decodeDocString(rawString: string): string {
  const unescaped = rawString.replace(/\r/g, '').replace(/\t/g, '        ');
  const lines = unescaped.split('\n');
  let leftSpacesToRemove = Number.MAX_VALUE;
  lines.forEach((line, index) => {
    if (lines.length <= 1 || index > 0) {
      const trimmed = line.trimLeft();
      if (trimmed) {
        leftSpacesToRemove = Math.min(leftSpacesToRemove, line.length - trimmed.length);
      }
    }
  });
  if (leftSpacesToRemove >= Number.MAX_VALUE) {
    leftSpacesToRemove = 0;
  }
  const trimmedLines: string[] = [];
  lines.forEach((line, index) => {
    if (index === 0) {
      trimmedLines.push(line.trimRight());
    } else {
      trimmedLines.push(line.substr(leftSpacesToRemove).trimRight());
    }
  });
  while (trimmedLines.length > 0 && trimmedLines[0].length === 0) {
    trimmedLines.shift();
  }
  while (trimmedLines.length > 0 && trimmedLines[trimmedLines.length - 1].length === 0) {
    trimmedLines.pop();
  }
  return trimmedLines.join('\n');
}
export function extractParameterDocumentation(functionDocString: string, paramName: string): string | undefined {
  if (!functionDocString || !paramName) {
    return undefined;
  }
  const docStringLines = functionDocString.split('\n');
  for (const line of docStringLines) {
    const trimmedLine = line.trim();
    let paramOffset = trimmedLine.indexOf('@param ' + paramName);
    if (paramOffset >= 0) {
      return trimmedLine.substr(paramOffset + 7);
    }
    paramOffset = trimmedLine.indexOf(':param ' + paramName);
    if (paramOffset >= 0) {
      return trimmedLine.substr(paramOffset + 7);
    }
    paramOffset = trimmedLine.indexOf(paramName + ': ');
    if (paramOffset >= 0) {
      return trimmedLine.substr(paramOffset);
    }
    paramOffset = trimmedLine.indexOf(paramName + ' (');
    if (paramOffset >= 0) {
      return trimmedLine.substr(paramOffset);
    }
  }
  return undefined;
}
