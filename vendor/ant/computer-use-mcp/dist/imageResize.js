const API_RESIZE_PARAMS = {
  pxPerToken: 28,
  maxTargetPx: 1568,
  maxTargetTokens: 1568
};
function nTokensForPx(px, pxPerToken) {
  return Math.floor((px - 1) / pxPerToken) + 1;
}
function nTokensForImg(width, height, pxPerToken) {
  return nTokensForPx(width, pxPerToken) * nTokensForPx(height, pxPerToken);
}
function targetImageSize(width, height, params) {
  const { pxPerToken, maxTargetPx, maxTargetTokens } = params;
  if (width <= maxTargetPx && height <= maxTargetPx && nTokensForImg(width, height, pxPerToken) <= maxTargetTokens) {
    return [width, height];
  }
  if (height > width) {
    const [w, h] = targetImageSize(height, width, params);
    return [h, w];
  }
  const aspectRatio = width / height;
  let upperBoundWidth = width;
  let lowerBoundWidth = 1;
  for (; ; ) {
    if (lowerBoundWidth + 1 === upperBoundWidth) {
      return [
        lowerBoundWidth,
        Math.max(Math.round(lowerBoundWidth / aspectRatio), 1)
      ];
    }
    const middleWidth = Math.floor((lowerBoundWidth + upperBoundWidth) / 2);
    const middleHeight = Math.max(Math.round(middleWidth / aspectRatio), 1);
    if (middleWidth <= maxTargetPx && nTokensForImg(middleWidth, middleHeight, pxPerToken) <= maxTargetTokens) {
      lowerBoundWidth = middleWidth;
    } else {
      upperBoundWidth = middleWidth;
    }
  }
}
export {
  API_RESIZE_PARAMS,
  nTokensForPx,
  targetImageSize
};
