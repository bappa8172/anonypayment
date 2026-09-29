import React from 'react';
import { Link } from 'react-router-dom';

/**
 * BrandLogo — Official AnonyGateway Identity Component
 * Renders the authentic circuit-keyhole AG monogram & wordmark.
 */
export default function BrandLogo({
  size = 'md',
  className = '',
  to = null,
  style = {},
  alt = 'AnonyGateway — Secure Anonymous B2B Payments',
}) {
  const heights = {
    xs: '28px',
    sm: '36px',
    md: '44px',
    lg: '58px',
    xl: '72px',
  };

  const h = heights[size] || (typeof size === 'number' ? `${size}px` : size);

  const imgElement = (
    <img
      src="/logo.png"
      alt={alt}
      style={{
        height: h,
        width: 'auto',
        maxWidth: '100%',
        objectFit: 'contain',
        filter: 'drop-shadow(0 2px 10px rgba(212, 175, 55, 0.2))',
        transition: 'transform 0.2s ease, filter 0.2s ease',
      }}
      className={`brand-logo-img ${className}`}
    />
  );

  if (to) {
    return (
      <Link
        to={to}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          textDecoration: 'none',
          ...style,
        }}
        className="brand-logo-link"
      >
        {imgElement}
      </Link>
    );
  }

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        ...style,
      }}
      className="brand-logo-container"
    >
      {imgElement}
    </div>
  );
}
