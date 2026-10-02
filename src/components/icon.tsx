import { config, type IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

// Supporting CSS is bundled with the site. Runtime style injection would
// violate the production CSP, and prerendered SVGs need no icon-font request.
config.autoAddCss = false;

interface IconProps {
  icon: IconDefinition;
  className?: string;
}

export function Icon({ icon, className }: IconProps) {
  return (
    <FontAwesomeIcon
      icon={icon}
      className={className}
      aria-hidden="true"
      focusable="false"
    />
  );
}
