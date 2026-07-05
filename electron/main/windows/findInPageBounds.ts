export type ViewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const FIND_IN_PAGE = {
  width: 320,
  height: 54,
  offset: 12,
  viewPadding: 8,
  topBarHeight: 58,
} as const;

/** Original `lbe(width)` equivalent from the main-process bundle. */
export function getFindInPageBounds(windowWidth: number): ViewBounds {
  return {
    x: windowWidth - FIND_IN_PAGE.width - FIND_IN_PAGE.offset - FIND_IN_PAGE.viewPadding,
    y: FIND_IN_PAGE.topBarHeight + FIND_IN_PAGE.offset - FIND_IN_PAGE.viewPadding,
    width: FIND_IN_PAGE.width + FIND_IN_PAGE.viewPadding * 2,
    height: FIND_IN_PAGE.height + FIND_IN_PAGE.viewPadding * 2,
  };
}
