#include "EmbeddedAssets.h"

#include <BinaryData.h>

#include <cstring>

namespace lqsurface
{
EmbeddedAsset findEmbeddedAsset (const char* originalFileName)
{
    if (originalFileName == nullptr)
        return {};

    for (int i = 0; i < BinaryData::namedResourceListSize; ++i)
    {
        if (std::strcmp (BinaryData::originalFilenames[i], originalFileName) != 0)
            continue;

        int size = 0;

        if (const auto* data = BinaryData::getNamedResource (BinaryData::namedResourceList[i], size);
            data != nullptr && size > 0)
            return { data, static_cast<size_t> (size) };
    }

    return {};
}
} // namespace lqsurface
