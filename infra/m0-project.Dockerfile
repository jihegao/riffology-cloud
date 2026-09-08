FROM docker.io/cloudflare/sandbox:0.12.9-python@sha256:f3c089b1bbb9dd85eeca09e20d841e6900390f45fb4e84dfbef0e9d17ddac806

# No platform credentials, Pi resources, or authoritative Session in this image.
# Package/image version matching is checked by the SDK. A release additionally
# records the resolved image digest; a tag alone does not pass G0.
ENV PYTHON_POOL_MIN_SIZE=0 \
    JAVASCRIPT_POOL_MIN_SIZE=0 \
    TYPESCRIPT_POOL_MIN_SIZE=0
EXPOSE 8080
