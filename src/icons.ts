/** Phosphor icons (MIT), inlined as SVG so they inherit `currentColor` and size from CSS. */
import check from "@phosphor-icons/core/assets/regular/check.svg?raw";
import x from "@phosphor-icons/core/assets/regular/x.svg?raw";
import trash from "@phosphor-icons/core/assets/regular/trash.svg?raw";
import external from "@phosphor-icons/core/assets/regular/arrow-square-out.svg?raw";
import email from "@phosphor-icons/core/assets/regular/envelope-simple.svg?raw";
import oneClick from "@phosphor-icons/core/assets/regular/lightning.svg?raw";
import link from "@phosphor-icons/core/assets/regular/globe-simple.svg?raw";
import star from "@phosphor-icons/core/assets/regular/star.svg?raw";
import starFill from "@phosphor-icons/core/assets/fill/star-fill.svg?raw";
import heart from "@phosphor-icons/core/assets/fill/heart-fill.svg?raw";
import userMinus from "@phosphor-icons/core/assets/regular/user-minus.svg?raw";
import refresh from "@phosphor-icons/core/assets/regular/arrow-clockwise.svg?raw";
import search from "@phosphor-icons/core/assets/regular/magnifying-glass.svg?raw";
import shield from "@phosphor-icons/core/assets/regular/shield-check.svg?raw";
import lock from "@phosphor-icons/core/assets/regular/lock-simple.svg?raw";
import back from "@phosphor-icons/core/assets/regular/caret-left.svg?raw";
import warning from "@phosphor-icons/core/assets/regular/warning.svg?raw";
import plus from "@phosphor-icons/core/assets/regular/plus.svg?raw";
import newspaper from "@phosphor-icons/core/assets/regular/newspaper.svg?raw";
import seal from "@phosphor-icons/core/assets/regular/seal-check.svg?raw";

const prepare = (svg: string) => svg.replace("<svg ", '<svg aria-hidden="true" focusable="false" class="icon" ');

export const icons = {
  check: prepare(check),
  x: prepare(x),
  trash: prepare(trash),
  external: prepare(external),
  email: prepare(email),
  oneClick: prepare(oneClick),
  link: prepare(link),
  star: prepare(star),
  starFill: prepare(starFill),
  heart: prepare(heart),
  userMinus: prepare(userMinus),
  refresh: prepare(refresh),
  search: prepare(search),
  shield: prepare(shield),
  lock: prepare(lock),
  back: prepare(back),
  warning: prepare(warning),
  plus: prepare(plus),
  newspaper: prepare(newspaper),
  seal: prepare(seal),
};

export type IconName = keyof typeof icons;
