#import "MilagrePasteHook.h"
#import <React/RCTUITextView.h>
#import <objc/runtime.h>

static char handlerKey;

// Only registered RCTUITextViews change behavior. All other inputs use React Native's original methods.
@interface RCTUITextView (MilagrePaste)
- (void)milagre_paste:(id)sender;
- (BOOL)milagre_canPerformAction:(SEL)action withSender:(id)sender;
@end

@implementation RCTUITextView (MilagrePaste)
- (void)milagre_paste:(id)sender
{
  MilagrePasteHandler handler = objc_getAssociatedObject(self, &handlerKey);
  if (handler && self.editable && UIPasteboard.generalPasteboard.hasImages) {
    handler(UIPasteboard.generalPasteboard.image);
    return;
  }
  [self milagre_paste:sender];
}

- (BOOL)milagre_canPerformAction:(SEL)action withSender:(id)sender
{
  if (action == @selector(paste:) && !self.contextMenuHidden && self.editable &&
      objc_getAssociatedObject(self, &handlerKey) && UIPasteboard.generalPasteboard.hasImages) {
    return YES;
  }
  return [self milagre_canPerformAction:action withSender:sender];
}
@end

static RCTUITextView *findInput(UIView *view)
{
  if ([view isKindOfClass:RCTUITextView.class]) return (RCTUITextView *)view;
  for (UIView *child in view.subviews) {
    RCTUITextView *input = findInput(child);
    if (input) return input;
  }
  return nil;
}

BOOL MilagreAttachPaste(UIView *view, MilagrePasteHandler handler)
{
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    Class cls = RCTUITextView.class;
    method_exchangeImplementations(class_getInstanceMethod(cls, @selector(paste:)),
                                   class_getInstanceMethod(cls, @selector(milagre_paste:)));
    method_exchangeImplementations(class_getInstanceMethod(cls, @selector(canPerformAction:withSender:)),
                                   class_getInstanceMethod(cls, @selector(milagre_canPerformAction:withSender:)));
  });
  RCTUITextView *input = findInput(view);
  if (!input) return NO;
  objc_setAssociatedObject(input, &handlerKey, handler, OBJC_ASSOCIATION_COPY_NONATOMIC);
  return YES;
}

void MilagreDetachPaste(UIView *view)
{
  RCTUITextView *input = findInput(view);
  if (input) objc_setAssociatedObject(input, &handlerKey, nil, OBJC_ASSOCIATION_COPY_NONATOMIC);
}
