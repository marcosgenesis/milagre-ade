#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN
typedef void (^MilagrePasteHandler)(UIImage * _Nullable image);
BOOL MilagreAttachPaste(UIView *view, MilagrePasteHandler handler);
void MilagreDetachPaste(UIView *view);
NS_ASSUME_NONNULL_END
