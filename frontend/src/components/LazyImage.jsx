import React, { useState, useEffect, useRef } from "react";

export function LazyImage({ src, alt, style, fallbackSvg }) {
  const [inView, setInView] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!src) {
      setInView(false);
      return;
    }

    setError(false);
    setLoaded(false);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" } // Load slightly ahead of scroll
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [src]);

  const showFallback = !src || error;

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...style
      }}
      className={!loaded && !showFallback ? "shimmer-placeholder" : ""}
    >
      {inView && src && !error && (
        <img
          src={src}
          alt={alt}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: loaded ? 1 : 0,
            transition: "opacity 0.4s ease-in-out",
            position: "absolute",
            top: 0,
            left: 0
          }}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setError(true);
            setLoaded(true);
          }}
        />
      )}
      {showFallback && fallbackSvg}
    </div>
  );
}
